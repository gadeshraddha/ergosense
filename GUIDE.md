# ErgoSense: Your Step-by-Step Build Guide (first-time friendly)

Commands below are for **Windows** (PowerShell / VS Code terminal). On Mac/Linux, `python` becomes `python3` and `.venv\Scripts\activate` becomes `source .venv/bin/activate`.

The big idea: **your GitHub repo is the single source of truth.** Claude and Cursor both just edit the same folder. You commit after every module, so you can switch tools, run out of tokens, or break something and never lose progress.

---

## PART 1: What to install

| # | Tool | Why you need it | Where |
|---|---|---|---|
| 1 | **Git** | Save points + push to GitHub | git-scm.com |
| 2 | **Python 3.11 or 3.12** | Backend + AI pipeline. MediaPipe can be fussy on the very newest Python, so stick to 3.11/3.12. Tick **"Add Python to PATH"** in the installer. | python.org |
| 3 | **Node.js (LTS version)** | Runs the React frontend | nodejs.org |
| 4 | **VS Code** | You already have it | |
| 5 | **Cursor** | A separate editor app (it's a VS Code clone). It is NOT a VS Code extension. You open the same project folder in it when it's Cursor's turn. | cursor.com |
| 6 | **Arduino IDE 2** | Only at the very end, to flash the ESP32. Skip for now. | arduino.cc |

**VS Code extensions** (press `Ctrl+Shift+X`, search by name, click Install):
- **Claude Code** (publisher: Anthropic). This is your AI builder inside VS Code.
- **Python** (Microsoft) and **Pylance**
- **ESLint** and **Prettier - Code formatter**
- **Tailwind CSS IntelliSense**
- **SQLite Viewer** (lets you peek inside your database)
- **GitLens** (optional, nicer git view)

**Heads-up on Claude Code access:** per Anthropic's docs the extension needs a **paid Claude plan (Pro, Max, Team or Enterprise) or a Claude Console account**. You sign in the first time you open it. If it says your plan doesn't include it, tell me and we'll switch the "important modules" to another route.

---

## PART 2: One-time setup (do this once, about 20 minutes)

**Step 1. Check your installs.** In VS Code: `Terminal → New Terminal`, then run:
```
git --version
python --version
node --version
npm --version
```
All four should print a version. If one says "not recognized", close and reopen VS Code (or reinstall and tick "Add to PATH").

**Step 2. Tell git who you are** (once per computer):
```
git config --global user.name "Your Name"
git config --global user.email "your-github-email@example.com"
```

**Step 3. Open your repo in VS Code.**
- Not on your computer yet: `Ctrl+Shift+P` → type **Git: Clone** → paste your repo URL → pick a folder → click **Open**. A browser tab may ask you to sign in to GitHub. Allow it.
- Already on your computer: `File → Open Folder`.

**Step 4. Drop in the project kit.** Unzip `ergosense_kit.zip`. Copy **everything inside it** into the root of your repo: `CLAUDE.md`, `CONTEXT.md`, `.gitignore`, the `docs` folder and the `.cursor` folder. (`.cursor` is hidden: in File Explorer turn on `View → Show → Hidden items`.) You should now see `CLAUDE.md` and `docs/modules/M1-...md` in VS Code's file list.

> What this does: `CLAUDE.md` is the rulebook Claude Code reads automatically. `.cursor/rules` is the same rulebook for Cursor. So you never paste the long brief again. The module files hold the exact prompts.

**Step 5. Add Qwen's old code as reference.** Extract your `workspace.tar` into a temporary folder (Windows 10/11: `tar -xf workspace.tar` in a terminal). Copy **only the `ergosense` folder** (the Python one) into your repo as `reference/qwen_old/ergosense`. Don't copy `src`, `dist`, `dashboard` or `node_modules`. That's the fake stuff. Claude will borrow good ideas from the Python code.

**Step 6. Your first commit (a save point).**
- Click the **branch icon** in the left bar (Source Control, `Ctrl+Shift+G`).
- Type a message like `Add project kit` in the box, click **Commit**, then click **Sync Changes** (that pushes to GitHub).
- Terminal version of the same thing:
```
git add .
git commit -m "Add project kit"
git push
```
Open your repo on github.com and confirm the files are there.

**Step 7. Sign in to Claude Code.** Click the **Spark icon** in the top right of the editor (you need a file open) or in the left bar. Sign in when asked. Test it by typing: *"Which project rule files can you see?"* It should mention `CLAUDE.md`. 

**Step 8. (Later, at M4) Cursor.** Open Cursor, `File → Open Folder`, pick the same repo folder. Check `Cursor Settings → Rules` and confirm "ergosense" is listed. If it isn't, just paste the text of `CLAUDE.md` as your first message.

You're set up. Now the loop.

---

## PART 3: The loop you repeat for every module

1. **Start clean.** In the terminal run `git status`. It should say "nothing to commit". If not, commit first.
2. **Open the module file** (for example `docs/modules/M1-foundation-auth.md`). Copy the block under **"Paste this prompt"**.
3. **Open the right tool** (the module says which) and start a **brand-new chat**.
4. **Paste the prompt.** The tool will show a short plan (which files it'll create). Read it. Reply `ok go`, or push back if something looks off.
5. **Let it build.** It will ask permission to run commands or edit files. If you're unsure about one, reply *"what does this command do?"* before approving.
6. **Test it yourself** using the module's **Acceptance** checklist. Tick each box with your own eyes. If something fails, paste the **exact error text** plus what you did. Not "it's not working".
7. **Commit and push** (the command is at the bottom of each module file). Tick the module in `CONTEXT.md`.

**Switching tools (Claude ⇄ Cursor):** commit first, close the editor that was working, then open the folder in the other one. Never have both editing at once.

---

## PART 4: The roadmap

| Module | What | Tool | What you'll see when done |
|---|---|---|---|
| **M1** | Foundation + login + app shell | Claude Code | Real register/login, protected pages, sidebar |
| **M2** | Sensor engine + live stream | Claude Code | `/debug` page with numbers updating live (mock mode, no hardware) |
| **M3** | Calibration + AI brain + sessions | Claude Code | Calibration wizard, drift detection, real score + explanation |
| **M4** | Dashboard + Posture pages | Cursor | The pretty live dashboard |
| **M5** | Auto-brightness + voice + Lighting & Alerts/Settings pages | Cursor | Screen reacts to light, spoken prompts, settings |
| **M6** | Sessions + History pages + demo mode + README | Cursor | Charts over time, one-click demo, docs |

**Fastest path to a "wow, it's real" moment:** M1 → M2. After those two you have login plus live data moving on screen. Don't plug in the ESP32 until everything works in mock mode.

**Start now:** open `docs/modules/M1-foundation-auth.md`, copy the prompt, paste it into Claude Code. That's it.

---

## PART 5: Git cheat sheet (you only need these)

| I want to... | Command |
|---|---|
| See what changed | `git status` |
| Save a checkpoint | `git add .` then `git commit -m "message"` |
| Upload to GitHub | `git push` |
| Download latest | `git pull` |
| Undo edits to ONE file (back to last commit) | `git restore path/to/file` |
| Undo ALL uncommitted edits to existing files | `git restore .` (careful, this deletes your uncommitted work) |

Stay on the `main` branch. If a tool offers to create a branch, you can just say no. If `git push` is rejected, run `git pull` first, then push again.

---

## PART 6: Saving tokens and fixing common problems

**Saving tokens**
- New chat per module. Old chats carry thousands of tokens of baggage.
- Always make the tool show its plan first. A wrong plan costs a few lines; wrong code costs a whole module.
- Send exact error messages and ask for a minimal fix. Don't say "redo everything".
- Don't paste your whole codebase. The tools can read files themselves. Point at one file: `@backend/app/security.py`.
- Running out mid-module is fine. Commit what works, finish later or in the other tool.

**Common problems**
- `mediapipe` fails to install → check `python --version`; use 3.11/3.12.
- Camera doesn't open → Windows `Settings → Privacy & security → Camera` → allow desktop apps; close Zoom/Teams/Meet.
- "Port already in use" → an old server is still running. Close old terminals or restart VS Code.
- Login works but pages say 401 → the token expired or the backend restarted. Log in again.
- Tool says it can't find `CLAUDE.md` → the file isn't in the repo root. Check the folder level.
- ESP32 not detected (later) → check the USB cable carries data, find the COM port in Device Manager, and close the Arduino Serial Monitor (only one app can hold the port).
