---
name: skill-installer
description: Download and install agent skills from URLs into the ~/.chatshell/skills/ directory. This skill contains the exact workflow for parsing GitHub, GitLab, Bitbucket, and direct URLs, handling all URL variants (repo root, /tree/ directory, /blob/ file, raw content links), detecting single vs. multi-skill repos, managing conflicts with backups, and verifying installations. ALWAYS use this skill when the user shares any URL that might contain a SKILL.md or asks to install/add/download/grab/set up a skill from a link -- the skill knows the correct install path and directory structure that the agent cannot infer on its own. Also triggers when a user pastes a GitHub/GitLab/Bitbucket URL mentioning "skill" in the path.
metadata:
  author: ChatShell
  website: https://chatshell.app
---

# Skill Installer

Install skills from URLs into `~/.chatshell/skills/`. A "skill" is a directory containing a `SKILL.md` file, plus optional supporting files (`scripts/`, `references/`, `assets/`, etc.).

## Step 1: Classify the URL

Look at the URL and determine its type. This determines the download approach.

| URL type | How to recognize | Example | Download approach |
|----------|-----------------|---------|-------------------|
| **Repo root** | `github.com/owner/repo` (no path beyond repo) | `github.com/user/repo` | Clone the repo, scan for all SKILL.md files |
| **Directory path** | URL contains `/tree/` (GitHub/GitLab) or `/src/` (Bitbucket) | `github.com/user/repo/tree/main/skills/foo` | Clone or API-fetch that directory. Could be a single skill (contains SKILL.md) or a skills folder (children contain SKILL.md) -- Step 3 determines which |
| **Direct SKILL.md** | URL contains `/blob/` pointing to a SKILL.md | `github.com/user/repo/blob/main/skills/foo/SKILL.md` | Download the parent directory (the whole skill, not just the file) |
| **Raw content** | `raw.githubusercontent.com/...` or any URL ending in `SKILL.md` | `raw.githubusercontent.com/user/repo/main/skills/foo/SKILL.md` | Download the file, then fetch sibling files from the parent directory |

Extract these components:
- **Platform**: github / gitlab / bitbucket / other
- **Owner** and **repo** (for git platforms)
- **Branch** (from URL path; default `main`)
- **Path** within the repo (everything after the branch)

## Step 2: Download

### For repo root or directory URLs -- use git clone

This is the simplest and most reliable approach. Use a shallow clone:

```bash
TMPDIR=$(mktemp -d)
git clone --depth 1 --branch {branch} "https://{platform}/{owner}/{repo}.git" "$TMPDIR"
```

If the URL points to a specific directory, the skill files are at `$TMPDIR/{path}/`.
If it's a repo root, scan for all skills:

```bash
find "$TMPDIR" -name "SKILL.md" -type f
```

Each SKILL.md's parent directory is a skill to install.

**If git clone fails** (private repo, no git installed, etc.), fall back to the API approach below.

### For blob URLs -- download the parent skill directory

A blob URL points to a specific file (SKILL.md), but a skill is the whole directory. Strip the filename to get the parent directory path, then download that directory using the API approach below.

For example:
- `github.com/user/repo/blob/main/skills/foo/SKILL.md`
- Parent directory path: `skills/foo`
- Use the GitHub API to download everything in `skills/foo/`

### For raw/direct SKILL.md URLs -- use curl + discover siblings

Download the SKILL.md first:

```bash
curl -sL "{url}" -o /tmp/skill-download/SKILL.md
```

Then discover and download sibling files. Convert a raw GitHub URL back to an API URL:
- `raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}/SKILL.md`
- Parent directory API: `https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}`

List the parent directory via API and download all sibling files and subdirectories.

### API-based directory download (fallback)

When you need to download a specific directory without cloning the whole repo:

**GitHub** (prefer `gh` CLI if available):
```bash
gh api repos/{owner}/{repo}/contents/{path}?ref={branch}
```
Or with curl:
```bash
curl -sL "https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref={branch}"
```

The response is a JSON array. For each item:
- If `type` is `"file"`: download via `download_url`
- If `type` is `"dir"`: recurse into it with another API call

Download every file, preserving directory structure:
```bash
curl -sL "{download_url}" --create-dirs -o "{local_dir}/{path}"
```

**GitLab**:
```bash
curl -sL "https://gitlab.com/api/v4/projects/{owner}%2F{repo}/repository/tree?path={path}&ref={branch}&recursive=true"
```
Download each file:
```bash
curl -sL "https://gitlab.com/api/v4/projects/{owner}%2F{repo}/repository/files/{file_path_encoded}/raw?ref={branch}" -o "{local_path}"
```

## Step 3: Identify skills to install

After downloading, determine what the target directory contains. This matters because a URL like `/tree/main/skills` could be either a single skill directory or a folder of skills:

1. **Check if the directory itself is a skill**: does it contain a `SKILL.md` at the top level?
   - **Yes** → This is a single skill. Install this directory as one skill.
   - **No** → This is a skills folder. Scan its child directories for `SKILL.md` files. Each child directory that contains a `SKILL.md` is a separate skill.

For each discovered skill:

1. Read the SKILL.md YAML frontmatter to get the `name` and `description` fields
2. The install name is determined by (in priority order):
   - The `name` field from frontmatter
   - The directory name containing the SKILL.md
   - The last meaningful path segment from the URL

If multiple skills are found:
1. List all discovered skills with their names and descriptions
2. Ask the user which to install (default: install all)

## Step 4: Install

Check for conflicts first. If `~/.chatshell/skills/{skill-name}/` already exists:
1. Tell the user the skill already exists
2. Ask whether to overwrite or skip
3. If overwriting, back it up: `mv ~/.chatshell/skills/{skill-name} ~/.chatshell/skills/{skill-name}.bak`

Install the skill:
```bash
mkdir -p ~/.chatshell/skills/{skill-name}
cp -r {source_dir}/* ~/.chatshell/skills/{skill-name}/
```

Clean up temp files:
```bash
rm -rf "$TMPDIR"
```

## Step 5: Verify and report

1. Confirm `~/.chatshell/skills/{skill-name}/SKILL.md` exists
2. Read its frontmatter to extract name and description
3. List all installed files

Report to the user:
- Skill name and description (from frontmatter)
- Install path: `~/.chatshell/skills/{skill-name}/`
- List of files installed
- The skill is now available for auto-detection by the agent

## Error Handling

- **Branch not found**: try `main`, then `master`, then `develop`
- **URL unreachable**: report the HTTP status code and suggest verifying the URL
- **No SKILL.md found**: tell the user clearly that no skill was found at the URL and suggest checking it points to a valid skill directory
- **git not available**: fall back to API-based download
- **Private repo**: suggest using `gh auth login` or configuring git credentials
