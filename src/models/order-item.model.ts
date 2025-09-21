/**
 * =============================================================================
 * OrderItemModel
 * =============================================================================
 * Represents a line item in an order. Each row corresponds to a product lot
 * (from Stock) and stores the ordered quantity, unit price, and total cost.
 *
 * Notes:
 * - `unitPrice` defaults to the stock price if not provided explicitly.
 * - Composite primary key: (orderId, stockId)
 * =============================================================================
 */

import {
  Table,
  Model,
  Column,
  DataType,
  Index,
  PrimaryKey,
} from 'sequelize-typescript';

@Table({
  tableName: 'order_items',
  timestamps: true,
  indexes: [
    { name: 'idx_order_items_orderId', fields: ['orderId'] },
    { name: 'idx_order_items_stockId', fields: ['stockId'] },
  ],
})
export class OrderItemModel extends Model {
  /** Composite Primary Key */
  @PrimaryKey
  @Column({ type: DataType.UUID, allowNull: false })
  @Index('idx_order_items_orderId')
  declare orderId: string;

  @PrimaryKey
  @Column({ type: DataType.UUID, allowNull: false })
  @Index('idx_order_items_stockId')
  declare stockId: string;

  /** Quantity ordered (DECIMAL string with 3 decimals) */
  @Column({ type: DataType.DECIMAL(12, 3), allowNull: false })
  declare quantity: string;

  /** Unit price (DECIMAL string with 2 decimals) */
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false })
  declare unitPrice: string;

  /** Line total (quantity × unitPrice) */
  @Column({ type: DataType.DECIMAL(12, 2), allowNull: false })
  declare lineTotal: string;

  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  toJSON() {
    const {
      orderId,
      stockId,
      quantity,
      unitPrice,
      lineTotal,
      createdAt,
      updatedAt,
    } = this.get();
    return {
      orderId,
      stockId,
      quantity,
      unitPrice,
      lineTotal,
      createdAt,
      updatedAt,
    };
  }
}
