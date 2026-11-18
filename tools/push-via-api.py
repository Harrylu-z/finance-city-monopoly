#!/usr/bin/env python3
"""
通过 GitHub API 推送分支 —— 当 github.com:443 直连不可用时的备用通道。

⚠ 背景：本机网络对 github.com:443 直连超时，但 api.github.com 正常。
   `git push` 走前者会失败，因此改用 Git Data API（走 api.github.com）。

用法：
    python tools/push-via-api.py <local-branch> <remote-branch> [base-branch]

原理：
    1. 递归遍历本地分支相对 base 的目录树
    2. 用 blob API 上传所有新增/修改的文件
    3. 用 tree API 自底向上重建每一层目录
    4. 用 commit API 创建 commit（作者/时间戳与本地一致）
    5. 创建/更新 ref
"""
import datetime
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = "Harrylu-z/finance-city-monopoly"


def git(*args, binary=False):
    r = subprocess.run(["git", "-C", ROOT, *args], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失败:\n{r.stderr.decode(errors='replace')}")
    return r.stdout if binary else r.stdout.decode(errors="replace")


def api(method, path, payload=None, allow_404=False):
    cmd = ["gh", "api", "-X", method, path]
    if payload is not None:
        cmd += ["--input", "-"]
    r = subprocess.run(cmd, input=json.dumps(payload).encode() if payload is not None else None,
                       capture_output=True)
    out = r.stdout.decode(errors="replace").strip()
    if r.returncode != 0:
        if allow_404 and "404" in r.stderr.decode(errors="replace"):
            return None
        raise RuntimeError(f"{method} {path} 失败:\n{r.stderr.decode(errors='replace')}")
    return json.loads(out) if out else None


def parse_ident(raw):
    """git ident ("Name <email> ts tz") -> {name, email, date}"""
    m = re.match(r"^(.*?)\s*<([^>]*)>\s*(\d+)\s+([+-]\d{4})$", raw)
    if not m:
        return {"name": raw.strip(), "email": "cfsc@users.noreply.github.com",
                "date": "1970-01-01T00:00:00Z"}
    name, email, ts, tz = m.group(1), m.group(2), int(m.group(3)), m.group(4)
    sign = 1 if tz[0] == "+" else -1
    off = sign * (int(tz[1:3]) * 60 + int(tz[3:5]))
    dt = datetime.datetime.fromtimestamp(ts, datetime.timezone.utc)
    dt += datetime.timedelta(minutes=off)
    return {"name": name, "email": email,
            "date": dt.strftime("%Y-%m-%dT%H:%M:%S") + tz[:3] + ":00"}


def upload_tree(path, tree_sha, store):
    """
    递归上传目录树，返回新的 tree sha。

    tree_sha = 该目录的**本地** tree 对象 sha（新建则为 None）
    store = {local_blob_sha: remote_blob_sha} 缓存
    """
    if tree_sha is None:
        return None
    # 直接读 tree 对象（不走路径 —— 子树的 sha 已知）
    raw = git("cat-file", "-p", tree_sha, binary=True)
    entries = []
    for line in raw.split(b"\n"):
        if not line.strip():
            continue
        meta, _, name = line.partition(b"\t")
        parts = meta.split()
        mode, otype, sha = parts[0].decode(), parts[1].decode(), parts[2].decode()
        entries.append((mode, otype, sha, name.decode(errors="replace")))

    api_entries = []
    for mode, otype, sha, name in entries:
        full = f"{path}/{name}" if path else name
        if otype == "blob":
            # 上传 blob（内容按 UTF-8 传；二进制文件走 base64）
            remote_sha = store.get(sha)
            if remote_sha is None:
                content = git("cat-file", "blob", sha, binary=True)
                try:
                    text = content.decode("utf-8")
                    payload = {"content": text, "encoding": "utf-8"}
                except UnicodeDecodeError:
                    import base64 as _b64
                    payload = {"content": _b64.b64encode(content).decode(), "encoding": "base64"}
                res = api("POST", f"repos/{REPO}/git/blobs", payload)
                remote_sha = res["sha"]
                store[sha] = remote_sha
                print(f"    blob {full} ({len(content)}B)")
            api_entries.append({"path": name, "mode": mode, "type": "blob", "sha": remote_sha})
        elif otype == "tree":
            # 子目录：递归上传
            sub = upload_tree(full, sha, store)
            api_entries.append({"path": name, "mode": mode, "type": "tree", "sha": sub})
        else:
            # commit（submodule）—— 本项目没有，忽略
            continue

    res = api("POST", f"repos/{REPO}/git/trees", {"tree": api_entries})
    return res["sha"]


def remote_ref_sha(branch):
    """取远端分支的当前 SHA（不存在返回 None）"""
    res = api("GET", f"repos/{REPO}/git/ref/heads/{branch}", allow_404=True)
    return res["object"]["sha"] if res else None


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    local = sys.argv[1]
    remote = sys.argv[2]
    base = sys.argv[3] if len(sys.argv) > 3 else "main"

    head_sha = git("rev-parse", local).strip()
    local_base_sha = git("rev-parse", base).strip()

    # ⚠ base SHA 必须用**远端**的那个。
    #   API 通道重建 commit 时 SHA 会变（作者/时间戳/树对象都可能不同），
    #   所以本地 base 与远端 base 常常不是同一个 commit。
    #   若拿本地 SHA 当 parent，GitHub 会报
    #   "Parent SHA does not exist or is not a commit object"（422）。
    base_sha = remote_ref_sha(base) or local_base_sha

    print(f"推送 {local} -> {remote}")
    print(f"  base {base_sha[:8]}（远端 {base}）-> head {head_sha[:8]}")

    # base commit 在远端必须已存在
    api("GET", f"repos/{REPO}/git/commits/{base_sha}", allow_404=True)
    print(f"  base commit 已在远端")

    # 待上传的 commit = 本地 head 相对**本地 base**的增量
    # （远端 base 与本地 base 的树内容应等价 —— 增量只需覆盖这些 commit）
    commits = git("rev-list", "--reverse", f"{local_base_sha}..{head_sha}").split()
    print(f"  {len(commits)} 个 commit 待上传")

    store = {}
    mapping = {base_sha: base_sha}
    parent_sha = base_sha

    for c in commits:
        raw = git("cat-file", "-p", c, binary=True)
        lines = raw.split(b"\n")
        tree_sha = next(l.split()[1].decode() for l in lines if l.startswith(b"tree "))
        sep = lines.index(b"")
        message = b"\n".join(lines[sep + 1:]).decode(errors="replace")
        author_raw = next(l for l in lines if l.startswith(b"author ")).decode()
        committer_raw = next(l for l in lines if l.startswith(b"committer ")).decode()

        # 上传该 commit 的完整树（顶层）
        new_tree = upload_tree("", tree_sha, store)

        payload = {
            "message": message,
            "tree": new_tree,
            "parents": [parent_sha],
            "author": parse_ident(author_raw),
            "committer": parse_ident(committer_raw),
        }
        res = api("POST", f"repos/{REPO}/git/commits", payload)
        mapping[c] = res["sha"]
        parent_sha = res["sha"]
        print(f"    commit {c[:8]} -> {res['sha'][:8]}")

    # 创建/更新 ref
    ref_path = f"repos/{REPO}/git/refs/heads/{remote}"
    try:
        api("PATCH", ref_path, {"sha": mapping[head_sha], "force": False})
        print(f"  已更新 ref {remote}")
    except RuntimeError as e:
        if "404" in str(e) or "Reference does not exist" in str(e):
            api("POST", f"repos/{REPO}/git/refs",
                {"ref": f"refs/heads/{remote}", "sha": mapping[head_sha]})
            print(f"  已创建 ref {remote}")
        else:
            raise

    print(f"\n完成：{remote} @ {mapping[head_sha][:8]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
