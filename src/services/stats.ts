import { User } from '../models/User';
import { Order } from '../models/Order';
import { Deposit } from '../models/Deposit';
import { Product } from '../models/Product';
import { getStockMap } from './catalog';

export async function getStats() {
  const [stockMap, products, users, banned, dep, sales] = await Promise.all([
    getStockMap(),
    Product.find().sort({ name: 1 }).select('name price active').lean(),
    User.countDocuments(),
    User.countDocuments({ isBanned: true }),
    Deposit.aggregate([{ $match: { status: 'verified' } }, { $group: { _id: null, n: { $sum: 1 }, sum: { $sum: '$verifiedAmount' } } }]),
    Order.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, n: { $sum: 1 }, items: { $sum: '$quantity' }, sum: { $sum: '$total' } } }]),
  ]);
  const perProduct = products.map((p) => ({
    id: String(p._id),
    name: p.name,
    price: p.price,
    active: p.active,
    ...(stockMap.get(String(p._id)) ?? { total: 0, available: 0, sold: 0 }),
  }));
  const stock = perProduct.reduce((a, p) => ({ total: a.total + p.total, available: a.available + p.available, sold: a.sold + p.sold }), { total: 0, available: 0, sold: 0 });
  return {
    stock,
    perProduct,
    users,
    banned,
    deposits: { count: dep[0]?.n ?? 0, sum: dep[0]?.sum ?? 0 },
    sales: { orders: sales[0]?.n ?? 0, items: sales[0]?.items ?? 0, revenue: sales[0]?.sum ?? 0 },
  };
}
