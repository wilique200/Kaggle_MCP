# Kaggle MCP Server

A remote MCP server that exposes the Kaggle API (competitions, leaderboards,
submissions, datasets) as tools Claude can call — including from the Claude
mobile app via a custom connector.

## Tools exposed (24)

**Competitions:** `list_competitions`, `get_leaderboard`, `list_submissions`,
`list_competition_files`, `download_competition_file`, `submit_prediction`,
`get_active_competitions_dashboard` (extra — see below)

**Notebooks:** `list_kernels`, `get_kernel_status`, `get_kernel_output`,
`pull_kernel`, `push_kernel` — run notebooks/scripts on Kaggle's own
infrastructure (CPU or GPU) and read back logs/output

**Datasets:** `list_datasets`, `list_dataset_files`, `download_dataset_file`,
`create_dataset`, `create_dataset_version`, `get_dataset_status`

**Models:** `list_models`, `get_model`, `create_model`, `delete_model`

### Extra: `get_active_competitions_dashboard`
Not a Kaggle API endpoint — a convenience tool this server adds on top. One
call pulls every competition you've entered plus your latest submission's
score/status for each, instead of you (or Claude) checking them one at a
time. Built for exactly the "manage all my active competitions" workflow.

### Compared to Kaggle's official connector (`kaggle.com/mcp`, ~71 tools)
This intentionally doesn't chase full parity. Left out as low-value for
standard competitions: simulation-competition episode/replay tools, hackathon
write-up management, forum/discussion tools, inbox file uploads, and the
deeper model-instance/version CRUD (framework variants, versioned weight
files) — those exist but add a lot of surface area for features you're
unlikely to need. If you hit a specific gap, it's cheap to add one tool for
it rather than building out the rest speculatively.

## No local machine? Deploy straight from GitHub, no `npm install` needed

You don't need Node installed anywhere to run this — Railway/Render build
the project in the cloud from source. The only local step (`npm install`)
was for testing before deploy; skip it entirely:

1. Create a new GitHub repo from your phone/browser (github.com → New →
   name it e.g. `kaggle-mcp-server`).
2. Add each file in this project via the GitHub web UI: repo → "Add file" →
   "Create new file", paste the contents, commit. Do this for
   `package.json`, `src/kaggleClient.js`, `src/tools.js`, `src/server.js`.
   (`.env.example` and this `README.md` are optional — real secrets go in
   Railway's dashboard, never committed.)
3. Go to Railway → New Project → Deploy from GitHub repo → pick the repo.
   Railway detects Node.js automatically, runs `npm install` and
   `npm start` for you.
4. Add the three environment variables (`KAGGLE_USERNAME`, `KAGGLE_KEY`,
   `MCP_BEARER_TOKEN`) in Railway's dashboard.
5. Once it's deployed, test it from your phone with any HTTPS client — even
   just visiting `https://your-app.up.railway.app/health` in the mobile
   browser should show `{"status":"ok"}`. The real integration test is
   adding it as a connector (step 3 below) and asking Claude to call
   `list_competitions`.

If you'd rather have a full coding environment without owning a laptop,
GitHub Codespaces (github.com → your repo → "Code" → "Codespaces") gives
you a browser-based VS Code + terminal, free tier included, entirely from
a phone or any borrowed computer — useful if you want to edit and commit
without the copy-paste-per-file approach above.

## 1. Local setup (optional — skip if following the no-laptop path above)

```bash
npm install
cp .env.example .env
# edit .env: fill in KAGGLE_USERNAME, KAGGLE_KEY (from
# https://www.kaggle.com/settings/account -> Create New Token),
# and set MCP_BEARER_TOKEN to a long random string
npm start
```

Server listens on `http://localhost:3000/mcp`.

### Verify the submission flow before relying on it

Kaggle's `submissions/url` endpoint response schema isn't published in
their swagger spec beyond "Result" — `kaggleClient.js` currently reads
`urlResp.token || urlResp.guid || urlResp.createUrl` to find the blob
token for the next step. **Test `submit_prediction` once against a real
competition and check the server logs** — if Kaggle's actual JSON key
differs, update the field name in `submitPrediction()` in
`src/kaggleClient.js`.

`push_kernel`'s field names (`newTitle`, `kernelType`, `isPrivate`,
`enableGpu`, `datasetDataSources`, etc.) come from Kaggle's internal API
client source rather than a public schema doc, so they're a step less
certain than the other endpoints. If a push fails with a validation error
naming a different field, that error message tells you the fix.

The four `models/*` tools are the least verified in this whole server —
built from third-party documentation of Kaggle's internal API rather than
Kaggle's own docs. Treat `create_model`/`delete_model` especially carefully
and expect to possibly need a field-name fix after the first real call.

## 2. Deploy to Railway

1. Push this folder to a new GitHub repo.
2. In Railway: New Project → Deploy from GitHub repo.
3. Add environment variables in the Railway dashboard: `KAGGLE_USERNAME`,
   `KAGGLE_KEY`, `MCP_BEARER_TOKEN`. Railway sets `PORT` automatically.
4. Once deployed, Railway gives you a public URL like
   `https://your-app.up.railway.app`. Your MCP endpoint is
   `https://your-app.up.railway.app/mcp`.
5. Sanity check: `curl https://your-app.up.railway.app/health` → `{"status":"ok"}`.

(Render works the same way — New Web Service → connect repo → same env vars
→ build command `npm install`, start command `npm start`.)

## 3. Add as a custom connector in Claude

1. On claude.ai (web): Settings → Connectors → Add custom connector.
2. URL: `https://your-app.up.railway.app/mcp`
3. If you set `MCP_BEARER_TOKEN`, add it wherever the connector form takes
   an auth header/token — the server expects `Authorization: Bearer <token>`.
4. Open the Claude mobile app → chat settings / the `+` menu → Connectors →
   toggle the Kaggle connector on for this chat.

## Security note

`submit_prediction` acts on your Kaggle account. Keep `MCP_BEARER_TOKEN`
set in production so the endpoint isn't open to anyone who finds the URL.
