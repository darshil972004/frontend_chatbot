## Chatbot React Frontend

React + Vite frontend that calls a Python API for chatbot property search, modeled after the existing PHP implementation.

### Setup
- Node 18+
- Install deps:

```bash
npm install
```

Create a `.env` with:

```bash
VITE_API_BASE_URL=http://localhost:8000
```

### Run

```bash
npm run dev
```

Then open the URL from the terminal (default `http://localhost:5173`).

### API Endpoints Expected
- `POST /chatbot/extract-params` body: `{ message: string }` → `{ result: string }`
- `GET /chatbot/get-chatbot-options` → `{ prices: number[], beds: number[], cities: string[] }`
- `GET /chatbot/property-search?price=&intBeds=&location=` → `{ properties: any[] }`

Configure your Python service to expose these endpoints or adjust `src/services/api.ts` accordingly.


