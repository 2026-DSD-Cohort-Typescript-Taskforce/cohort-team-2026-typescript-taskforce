# Cohort Team 2026 - TypeScript Taskforce

Our team project uses a TypeScript-based full-stack architecture with React, Node.js, Express, and Supabase.

## Tech Stack

-**Frontend:** Next.js, React, TypeScript

- **Backend:** Node.js, Express, TypeScript
- **Database:** Supabase (PostgreSQL)
- **Version control:** Git and GitHub
- **Deployment:** Vercel-Supabase

## Project Structure

```text
cohort-team-2026-typescript-taskforce/
├── client/                 # React + TypeScript frontend
├── server/                 # Express + TypeScript backend
│   └── src/
│       ├── routes/         # API routes
│       ├── controllers/    # Request handlers
│       ├── services/       # Business logic
│       ├── middleware/     # Express middleware
│       ├── config/         # Application configuration
│       ├── app.ts          # Express application setup
│       └── server.ts       # Starts the API server
├── .gitignore
├── package.json            # Root development scripts
└── README.md
```

## Prerequisites

Install the following before getting started:

- [Node.js](https://nodejs.org/) (Node.js 24 LTS recommended)
- npm (included with Node.js)
- [Git](https://git-scm.com/)
- A code editor, such as [Visual Studio Code](https://code.visualstudio.com/)

You will also need access to the team's GitHub repository.

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/dallassoftwaredevelopers/cohort-team-2026-typescript-taskforce.git
cd cohort-team-2026-typescript-taskforce
```

### 2. Install dependencies

Run these commands from the project root:

```bash
npm install
npm install --prefix client
npm install --prefix server
```

### 3. Configure environment variables

Create a local environment file for the backend:

```bash
touch server/.env
```

Add the following variables to `server/.env`:

```env
PORT=5000
CLIENT_URL=http://localhost:3000

SUPABASE_URL=
SUPABASE_SECRET_KEY=
```

Fill in the Supabase values when the team has configured its Supabase project. Make sure the variable names match those used in the backend code.

**Security notes:**

- Never commit `.env` files or secret keys to GitHub.
- Keep Supabase secret keys on the server. Never expose them in frontend code.
- Each developer should configure their own local environment.
- Use `server/.env.example` to document required variables without including real credentials.

## Run the application

From the project root, start both the frontend and backend:

```bash
npm run dev
```

### Why concurrently?

Without `concurrently`, you would need separate terminal windows to run the frontend and backend. With it, both development servers start together.
Expected local URLs:

| Application          | URL                              |
| -------------------- | -------------------------------- |
| Frontend             | http://localhost:3000            |
| Backend API          | http://localhost:5000            |
| Backend health check | http://localhost:5000/api/health |

Keep the terminal running while developing. Press `Ctrl + C` to stop the development servers.

### Run applications separately

Start only the frontend:

```bash
npm run dev --prefix client
```

Start only the backend:

```bash
npm run dev --prefix server
```

## Environment variables

| Variable              | Purpose                                                     |
| --------------------- | ----------------------------------------------------------- |
| `PORT`                | Port used by the backend API                                |
| `CLIENT_URL`          | Frontend origin allowed by the backend's CORS configuration |
| `SUPABASE_URL`        | Supabase project URL                                        |
| `SUPABASE_SECRET_KEY` | Server-side Supabase secret key; keep private               |

Production environment variables should be configured in the hosting platform's settings, not committed to GitHub.

## Development workflow

### Create a branch

Update your local `main` branch before starting a task:

```bash
git switch main
git pull origin main
```

Create a branch for your work:

```bash
git switch -c feature/your-feature-name
```

Examples:

```bash
git switch -c feature/user-authentication
git switch -c feature/dashboard
git switch -c fix/api-error-handling
```

### Commit and push your changes

Check your changes:

```bash
git status
```

Stage and commit your work:

```bash
git add .
git commit -m "Describe your change"
```

Push your branch:

```bash
git push -u origin feature/your-feature-name
```

Open a pull request on GitHub so the team can review your changes before merging.

**Team guideline:** Avoid committing directly to `main`. Use feature branches and pull requests.

## Deployment

- **Frontend:** Vercel
- **Database:** Supabase PostgreSQL
- **Backend:** Express

Configure production environment variables in the hosting platform. Never commit production credentials to GitHub.

## Troubleshooting

### Dependencies are missing

From the project root, run:

```bash
npm install
npm install --prefix client
npm install --prefix server
```

### Frontend cannot connect to the backend

Check that:

- Both development servers are running.
- The backend is listening on port `5000`.
- The frontend is using the correct API URL.
- `CLIENT_URL` is set to `http://localhost:3000`.
- The backend health check is available at http://localhost:5000/api/health.

## Running the Frontend and Backend Concurrently

We use [`concurrently`](https://www.npmjs.com/package/concurrently) to run the React frontend and Express backend simultaneously with a single command.

### Supabase connection issues

Verify that the Supabase project URL and required credentials are set in `server/.env`, and that the variable names match the backend code.

### Port already in use

Stop the process using the port, or configure the application to use a different port.

## Contributing

1. Pull the latest changes from `main`.
2. Create a feature branch.
3. Make and test your changes.
4. Commit and push your branch.
5. Open a pull request for review.

Keep changes focused, write readable TypeScript, and never commit credentials or generated files.

test
