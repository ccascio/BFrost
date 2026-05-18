# `local.publisher.wordpress` — WordPress Publisher Example

A worked example of a local BFrost worker that **consumes** `news.article` items from the Item Bus and publishes them to a self-hosted WordPress site through the WP REST API.

This is the reference replacement for the (private) ConvertPrivately worker. It's a real, working publisher — author your prompt, point it at your WP site, and queue items will turn into draft posts.

## What it does

For each scheduled run:

1. Picks the oldest queued/approved `news.article` item this consumer hasn't already handled.
2. Sends the item's title, description, excerpt, and source URL to the local model with your configurable prompt.
3. Posts the generated HTML body to WordPress via `POST /wp-json/wp/v2/posts`.
4. Writes the WP post id, link, status, and slug into `metadata['local.publisher.wordpress']` on the queue item.

If credentials are missing or the WP API call fails, the consumer marks the item as failed (up to 3 attempts) and surfaces the error in the events feed.

## Installation

This is an *example*. To use it on your machine:

1. Copy the directory into your local workers path: `cp -r workers/examples/wordpress-publisher workers/local/wordpress-publisher`.
2. In the dashboard, open the **Workers** tab and click **Rescan**.
3. The worker appears. Enable it. (BFrost compiles `src/index.ts` to `dist/index.js` automatically on first load.)
4. Open the **Config** tab and fill in the WordPress connection settings.

## Configuration

All settings live under **Config → WordPress connection** in the dashboard.

| Field | What it is |
| --- | --- |
| **WordPress base URL** | Your site root — `https://my-site.example.com`. No trailing slash, no `/wp-json`. |
| **Username** | A WordPress user account that has permission to publish. |
| **Application Password** | Generated at *Users → Profile → Application Passwords*. WP shows the password with spaces; paste it as-is. |
| **Publish as** | `draft` (recommended while testing), `pending`, `publish`, or `private`. |
| **Category slugs** | One slug per line. Resolved to category IDs from the taxonomy cache. |
| **Tag slugs** | Same shape as categories. |
| **Model alias** | Blank = default model. Otherwise an alias from the Models tab. |
| **Article style prompt** | The system prompt the model receives. Customise tone, voice, length, structure. Blank uses the built-in default. |

Saving the form triggers a `GET /wp-json/wp/v2/categories` + `/tags` fetch and caches the result in worker KV under `categories` and `tags`. The next save (or the dashboard's manual refresh) updates the cache.

Secrets fall back to environment variables when the manifest fields are blank:

- `WORDPRESS_BASE_URL`
- `WORDPRESS_USERNAME`
- `WORDPRESS_APPLICATION_PASSWORD`

## What it produces and consumes

- **Consumes**: `itemType: 'news.article'` from any producer worker (e.g. `core.news`).
- **Writes** under `metadata['local.publisher.wordpress']`: `{ postId, postUrl, postStatus, postSlug, postedAt }`.
- **Transitions** the item to `state: 'posted'` only when WP returns `status: 'publish'`. Drafts/pending/private leave the item in its previous state but mark the consumer handled.

## Backend routes the worker registers

- `GET /api/workers/local.publisher.wordpress/settings` — returns current settings (password is masked).
- `POST /api/workers/local.publisher.wordpress/settings` — saves and refreshes taxonomies.
- `POST /api/workers/local.publisher.wordpress/refresh-taxonomies` — manual category/tag refresh.
- `GET /api/workers/local.publisher.wordpress/taxonomies` — read the cached lists.
- `POST /api/workers/local.publisher.wordpress/ping` — verifies credentials by hitting `/users/me`.

## Notes for worker authors

This example demonstrates the patterns a real consumer worker needs:

- **Item Bus consumer pattern**: `withQueueLock` around `listItemsForConsumer` → `loadQueue` → `applyConsumerSuccess` / `applyConsumerFailure` → `saveQueue`.
- **Per-worker KV** (`openWorkerKv`) for both settings and the taxonomy cache. The full prefix is `worker.local.publisher.wordpress.<key>` in shared SQLite.
- **Backend routes** declared on `BackendWorkerModule.apiRoutes`. Each route owns its own JSON parsing and validation; `BadRequestError` becomes a 400.
- **Lifecycle hooks**: `onEnable` triggers a best-effort taxonomy refresh so a freshly-enabled worker has cached categories on first run.
- **`seedPath`** on each settings field initialises the form from live state (`workerData['local.publisher.wordpress'].settings.<field>`) — no extra client code needed.

## Limitations / on the roadmap

- Featured image upload is not implemented. Add a media POST to `/wp-json/wp/v2/media`, then set `featured_media` on the post.
- Multi-site WP is untreated; the worker assumes a single REST root.
- The category/tag picker is text-based today. A custom dashboard view via `dashboardSource` could render the cached taxonomy as a checkbox grid — see `workers/examples/dashboard-view/`.
- The article prompt does not pass published-article style examples. Add a `recentPostsLimit` setting and fetch `/wp-json/wp/v2/posts?per_page=N` if you want few-shot style anchoring.
