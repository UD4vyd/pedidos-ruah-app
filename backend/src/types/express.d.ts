declare global {
  namespace Express {
    interface Request {
      usuario?: { id: number; nombre: string; email: string };
    }
  }
}

export {};
