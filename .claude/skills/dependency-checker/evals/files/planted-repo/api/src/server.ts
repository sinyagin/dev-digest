import express from 'express';
import { OrderSchema } from '@acme/shared';

const app = express();
app.use(express.json());
app.post('/orders', (req, res) => {
  const order = OrderSchema.parse(req.body);
  res.status(201).json(order);
});
app.listen(4000);
