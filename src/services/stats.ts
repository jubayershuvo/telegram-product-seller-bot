import { User } from '../models/User';
import { Order } from '../models/Order';
import { Deposit } from '../models/Deposit';
import { getStock } from './inventory';

export async function getStats() {
  const [stock, users, banned, dep, sales] = await Promise.all([
    getStock(),
    User.countDocuments(),
    User.countDocuments({ isBanned: true }),
    Deposit.aggregate([{ $match: { status: 'verified' } }, { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: '$verifiedAmount' } } }]),
    Order.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, n: { $sum: 1 }, emails: { $sum: '$quantity' }, sum: { $sum: '$total' } } }]),
  ]);
  return {
    stock,
    users,
    banned,
    deposits: { count: dep[0]?.n ?? 0, sum: dep[0]?.sum ?? 0 },
    sales: { orders: sales[0]?.n ?? 0, emails: sales[0]?.emails ?? 0, revenue: sales[0]?.sum ?? 0 },
  };
}
