import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { errorHandler, notFound } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";

const app = express();

app.use(
  cors({
    origin: env.CLIENT_URL,
  })
);

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "success",
    message: "API is running!",
  });
});

app.use("/api/auth", authRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
