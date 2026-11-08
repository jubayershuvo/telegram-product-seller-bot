import { Context } from 'telegraf';
import { UserDoc } from '../models/User';

export interface BotContext extends Context {
  dbUser: UserDoc;
  isAdmin: boolean;
}
