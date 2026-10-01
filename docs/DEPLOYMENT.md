# Pineapple Siege deployment

This is the production setup as of September 30, 2026. The game is a static Vite app; GitHub stores the private source, and Cloudflare Pages builds and hosts it. No GitHub Actions workflow or local upload is needed for a normal release.

## Ownership and routing

| Item | Current value |
| --- | --- |
| GitHub owner and private repository | [`bn-bx/pineapple-siege`](https://github.com/bn-bx/pineapple-siege) |
| Git remote | `git@github.com:bn-bx/pineapple-siege.git` |
| Production branch | `main` |
| Cloudflare Pages project | `pineapple-siege-git` |
| Pages hostname | <https://pineapple-siege-git.pages.dev> |
| Production domain | <https://sweetpickledpineapple.com> |
| Separate basketball site | <https://hoops.sweetpickledpineapple.com> on the `sweet-pickled-pineapple` Pages project |
| Previous direct-upload project | `pineapple-siege`; replaced by the Git-backed project |

The apex domain is attached to `pineapple-siege-git`, with a Cloudflare-managed apex CNAME targeting `pineapple-siege-git.pages.dev`. Cloudflare reported the domain **Active** with SSL enabled after cutover. The older direct-upload project was detached from the apex during migration. It does not receive Git pushes; use the Git-backed project for all current releases.

Browser world saves live in IndexedDB for the site origin. Keeping the same apex domain during this migration preserved that origin. The Pages hostname and local preview use separate browser storage.

## GitHub access

GitHub repository visibility is **private**. On the original Mac, the local repository uses a dedicated Ed25519 SSH deploy key at `~/.ssh/pineapple_siege_ed25519`; GitHub lists its public half under **Settings → Deploy keys** as **Pineapple Siege Mac push key**, with write access. The key grants Git read/write access to this repository only. It is not a GitHub API credential, and Cloudflare does not use it. The private key is outside this repository and must never be committed or copied into Cloudflare build settings.

The original checkout selects that key through local `.git/config`:

```sh
git config --local core.sshCommand 'ssh -i /Users/bradenbax/.ssh/pineapple_siege_ed25519 -o IdentitiesOnly=yes'
git remote -v
```

That setting is local to this checkout and is not carried by a clone. On another machine, use your own GitHub SSH access or create a new repo-scoped deploy key and configure its path. Do not copy the original private key between machines. GitHub account access is still needed for repository settings, pull requests, and deploy-key management.

## Cloudflare connection and build

The **Cloudflare Workers and Pages** GitHub App is installed on `bn-bx` for the selected `pineapple-siege` repository. This integration lets Cloudflare clone commits and receive push/PR events. In Cloudflare, open **Workers & Pages → pineapple-siege-git** to inspect builds and domains.

The Pages project is configured as follows:

| Setting | Value |
| --- | --- |
| Source | GitHub `bn-bx/pineapple-siege` |
| Production branch | `main` |
| Root directory | Repository root |
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 22 via `.node-version`; `package.json` requires at least 22.12 |
| Production deployment | Automatic on pushes to `main` |

`npm run build` generates `public/world.json` and `public/world.bin`, checks TypeScript, and runs Vite. `dist/` is the complete static output. The generated world files, `dist/`, `node_modules/`, and local `.wrangler/` state are ignored by Git. `package-lock.json` is committed for repeatable dependency installation. `public/_headers` sets cache policy: hashed assets are immutable; the HTML and world files revalidate. There are no Pages Functions or runtime secrets.

Cloudflare creates preview deployments for eligible non-production branches and pull requests. These previews have their own URLs and browser save origins. The Cloudflare GitHub App must retain access to the repository; removing it stops Git builds. The local SSH key can be removed or rotated without affecting Cloudflare's connection.

## Normal development and release

```sh
git pull --ff-only origin main
npm ci
npm test
npm run build
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

Check the new commit under **Workers & Pages → pineapple-siege-git → Deployments**. Wait for **success**, then open the production domain. A successful `git push` only confirms that GitHub received the commit; it does not by itself confirm the Pages build. Avoid adding generated `public/world.*` or `dist/` files to the commit.

For a local preview, run `npm run dev` or `npm run build && npm run preview`. These use a different origin from production, so local browser saves are separate.

## Verify a deployment

1. Confirm the Pages deployment shows the intended `main` commit and **success**.
2. Confirm **Custom domains** shows `sweetpickledpineapple.com` as **Active** with SSL enabled.
3. Open <https://sweetpickledpineapple.com> and confirm the game reaches **Ready** and starts.
4. Check that `/world.json` and `/world.bin` return HTTP 200. If a new code change needs deeper validation, run `npm test` and test the affected gameplay in a browser.

For a quick remote check:

```sh
curl -fsSI https://sweetpickledpineapple.com/
curl -fsSI https://sweetpickledpineapple.com/world.json
curl -fsSI https://sweetpickledpineapple.com/world.bin
```

During the initial migration, the first Git build succeeded, the domain became Active with SSL, and the production site's HTML and two world files matched the Git-backed Pages hostname byte for byte. A later README-only push to `main` also built successfully, proving the automatic deployment path.

## Recovery and maintenance

- **Build fails:** open that deployment's build log. Reproduce with `npm ci && npm run build` on Node 22. Fix and push a new commit. Production continues to serve the last successful deployment.
- **Bad release:** use Cloudflare Pages deployment controls to roll back to a known successful deployment, or revert the Git commit and push. Verify the domain afterward. A dashboard rollback does not change Git history, so a later push can redeploy newer source.
- **GitHub push fails:** verify `git remote -v`, the deploy key's GitHub setting, and the local `core.sshCommand`. A deploy key can be revoked in repository **Settings → Deploy keys**; create a new key and update the checkout to rotate it.
- **Cloudflare stops seeing pushes:** check the GitHub App installation's selected-repository access and the Pages project's Git integration. The SSH deploy key is unrelated to this connection.
- **Domain fails:** check the new project's **Custom domains** status and the apex CNAME target. If the Pages project has a successful deployment but the apex fails, compare the Pages hostname and custom domain, then correct the binding or DNS record. Keep the apex origin when possible so browser saves remain accessible.

Never put API tokens, SSH private keys, or account recovery material in the repository, build logs, Pages environment variables, or verification reports unless a specific build feature actually requires them. This static build requires none.
