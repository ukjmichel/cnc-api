// src/models/order.model.ts
import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  Default,
  Index,
  ForeignKey,
} from 'sequelize-typescript';
import { UserModel } from './user.model.js';

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'fulfilled'
  | 'refunded';

@Table({
  tableName: 'orders',
  timestamps: true,
  indexes: [
    { name: 'idx_orders_status', fields: ['status'] },
    { name: 'idx_orders_userId', fields: ['userId'] },
    { name: 'idx_orders_pickupSlotId', fields: ['pickupSlotId'] },
    { name: 'idx_orders_createdAt', fields: ['createdAt'] },
  ],
})
export class OrderModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  declare orderId: string;

  /** FK → users.userId (nullable) — must be UUID to match users.userId */
  @ForeignKey(() => UserModel)
  @Index('idx_orders_userId')
  @Column({ type: DataType.UUID, allowNull: true })
  declare userId: string | null;

  @Index('idx_orders_status')
  @Column({
    type: DataType.ENUM(
      'draft',
      'pending',
      'paid',
      'cancelled',
      'fulfilled',
      'refunded'
    ),
    allowNull: false,
    defaultValue: 'pending',
  })
  declare status: OrderStatus;

  /** Monetary totals — stored as DECIMAL strings by Sequelize */
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false, defaultValue: 0 })
  declare subtotal: string;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false, defaultValue: 0 })
  declare taxTotal: string;

  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false, defaultValue: 0 })
  declare grandTotal: string;

  @Column({ type: DataType.STRING(3), allowNull: false, defaultValue: 'USD' })
  declare currency: string;

  /** Optional contact / pickup info */
  @Column({ type: DataType.STRING(191), allowNull: true })
  declare contactName: string | null;

  @Column({ type: DataType.STRING(191), allowNull: true })
  declare contactPhone: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare notes: string | null;

  /** FK → pickup_slots.slotId (nullable) — also UUID */
  @Index('idx_orders_pickupSlotId')
  @Column({ type: DataType.UUID, allowNull: true })
  declare pickupSlotId: string | null;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  toJSON() {
    const {
      orderId,
      userId,
      status,
      subtotal,
      taxTotal,
      grandTotal,
      currency,
      contactName,
      contactPhone,
      notes,
      pickupSlotId,
      createdAt,
      updatedAt,
    } = this.get();
    return {
      orderId,
      userId,
      status,
      subtotal,
      taxTotal,
      grandTotal,
      currency,
      contactName,
      contactPhone,
      notes,
      pickupSlotId,
      createdAt,
      updatedAt,
    };
  }
}
