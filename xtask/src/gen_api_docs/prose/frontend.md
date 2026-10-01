The default-enabled `frontend` Cargo feature builds and embeds the five-section dashboard into the daemon. Normal `cargo build` and `cargo build --release` install locked npm dependencies and compile the native Preact application; build-time requirements are Node.js 22.12 or newer and npm. The binary serves its bundled scripts, styles, fonts, and dashboard routes without a frontend source tree or JS runtime.

Use `cargo build --workspace --no-default-features` for a backend-only build that needs no JS toolchain or generated assets. `cargo build --workspace --no-default-features --features frontend` restores the dashboard. Native APIs remain available in either build. Unknown `/api`, `/v1`, `/assets`, and `/fonts` paths return 404 rather than the SPA entry.

The management listener also exposes the native `/v1` routes for same-origin dashboard chat. Protect the complete management listener with your existing authentication perimeter. The separate OpenAI listener continues to serve inference clients.

Services, Chat, Events, Stats, and Config use real API data. The browser captures live events and combines them with persisted automatic restarts; Ananke does not persist a complete general event history. The frontend does not expose temporary services. Open uses the service HTTP proxy port unless `metadata.web_ui_url` supplies a published HTTP or HTTPS URL.
