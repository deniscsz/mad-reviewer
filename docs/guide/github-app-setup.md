# GitHub App Setup

`mad-reviewer` authenticates as a **GitHub App** installed on your organization.
One App install covers every repository in the org, delivers webhooks centrally,
and mints short-lived per-repo tokens on demand. The App's identity is also what
lets the agent recognize and manage its own comments.

## 1. Create the App

Go to **Organization Settings → Developer settings → GitHub Apps → New GitHub
App** and configure:

- **Webhook URL** — the public URL of your running server (the root path `/`).
- **Webhook secret** — a random string. You will set the same value as
  `GITHUB_WEBHOOK_SECRET`. The server verifies the HMAC signature on every
  delivery.

## 2. Permissions

Grant exactly these repository permissions:

| Permission | Level | Why |
|---|---|---|
| Pull requests | **Read & write** | List/post/reply/resolve review comments |
| Contents | **Read** | Clone the PR head and base |
| Metadata | **Read** | Required baseline |

No other permissions are needed.

## 3. Event subscription

Subscribe to the **Pull request** event. The server only acts on the
`opened`, `synchronize`, and `reopened` actions; other actions are ignored.

## 4. Private key & credentials

1. Generate a **private key** (PEM) from the App settings page.
2. Note the **App ID**.
3. Put them in your environment:

```bash
GITHUB_APP_ID=123456
GITHUB_WEBHOOK_SECRET=your-webhook-secret
# The PEM is multi-line; keep the newlines (quote it, or load from a file/secret manager)
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----"
```

## 5. Install on the org

From the App page choose **Install App** and install it on your organization
(all repositories, or a selected set). Each installation gets its own
`installation_id`, which the server uses to mint a scoped token per run.

## Verify

With the server running and reachable, open or push to a PR in an installed
repo. Within a few seconds (after the [debounce window](/architecture/queue))
you should see inline review comments appear. Check the server logs — each run
emits a structured summary like:

```json
{"repo":"acme/api","pr":42,"sha":"abc1234","findings":3,"created":3,"kept":0,"resolved":0}
```

If nothing happens, confirm: the webhook deliveries show `2xx` in the App's
**Advanced** tab, the secret matches, and the AI CLI is installed/authenticated
in the server environment.
