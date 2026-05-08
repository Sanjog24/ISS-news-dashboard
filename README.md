# ISS Live Dashboard

A complete React + Vite dashboard for live International Space Station tracking, latest news, interactive charts, and a floating AI chatbot that only answers from dashboard data.

## Features

- ISS location refreshes automatically every 15 seconds.
- Leaflet map with current ISS marker and the last 15 positions as a trajectory.
- Haversine speed calculation with a 30-point speed history chart.
- Nearest place lookup with OpenStreetMap reverse geocoding and ocean fallback labels.
- People in space panel using Open Notify with a no-key fallback source.
- News dashboard with 10 total articles across Space and Science categories.
- 15-minute localStorage news cache, search, sort, category filter, and per-category refresh.
- Doughnut chart for article distribution; clicking a slice filters the article list.
- Floating chatbot using `mistralai/Mistral-7B-Instruct-v0.2` through Hugging Face when `VITE_AI_TOKEN` is configured.
- Local fallback chatbot logic that still obeys the data-only rule when the AI token is missing.
- Dark/light mode persistence, loading states, retryable errors, and toast notifications.

## Environment Variables

Create a `.env` file from `.env.example`:

```bash
VITE_NEWS_API_KEY=your_newsapi_key_here
VITE_AI_TOKEN=your_huggingface_token_here
```

The app never hardcodes API keys. `.env` and `.env.*` are ignored by git.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run lint
npm run build
```

## Deployment Notes

Deploy on Vercel and add these environment variables in the Vercel project settings:

- `VITE_NEWS_API_KEY`
- `VITE_AI_TOKEN`

The ISS assignment API is HTTP-only, so the app attempts it through a public proxy and falls back to a HTTPS ISS location API if that proxy is unavailable in production.

## Assignment Answer

LLM model used: `mistralai/Mistral-7B-Instruct-v0.2` via Hugging Face.

Why: it is an instruction-tuned open model that can follow a strict system prompt, making it suitable for a dashboard assistant that must answer only from supplied ISS and news context. The app also includes a local data-only fallback so it remains usable if the Hugging Face token is not configured.
