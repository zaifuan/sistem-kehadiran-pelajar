import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { healthRouter } from './routes/health.js';

export function buatApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan('tiny'));

  app.get('/', (req, res) => {
    res.json({
      mesej: 'Sistem Pantau Kehadiran Pelajar — server aktif (Fasa 1 skeleton).',
      health: '/api/health',
    });
  });

  app.use('/api', healthRouter);

  // 404
  app.use((req, res) => res.status(404).json({ ralat: 'Tidak dijumpai' }));

  return app;
}
