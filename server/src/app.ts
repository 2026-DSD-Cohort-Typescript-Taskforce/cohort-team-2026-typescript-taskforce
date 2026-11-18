import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { errorHandler, notFound } from './middleware/errorHandler';
import adminRoutes from './routes/admin.routes';
import authRoutes from './routes/auth.routes';
import stagehandRoutes from './routes/stagehand.routes';

const app = express();

app.use(
  cors({
    origin: env.CLIENT_URL,
  }),
);

// Worker routes authenticate before parsing bodies or opening a browser.
app.use(stagehandRoutes);
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'success',
    message: 'API is running!',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
