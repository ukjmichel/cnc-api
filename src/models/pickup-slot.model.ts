// src/models/pickup-slot.model.ts
import {
  Table,
  Model,
  Column,
  DataType,
  PrimaryKey,
  Default,
  HasMany,
  Index,
} from 'sequelize-typescript';
import { OrderModel } from './order.model.js';

export type PickupSlotStatus = 'open' | 'closed';

@Table({
  tableName: 'pickup_slots',
  timestamps: true,
  indexes: [
    { name: 'idx_pickup_slots_location', fields: ['location'] },
    { name: 'idx_pickup_slots_date', fields: ['date'] },
    { name: 'idx_pickup_slots_status', fields: ['status'] },
    // A slot is uniquely identified by (location, date, startTime, endTime)
    {
      name: 'uk_pickup_slots_location_date_window',
      unique: true,
      fields: ['location', 'date', 'startTime', 'endTime'],
    },
  ],
})
export class PickupSlotModel extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  declare slotId: string;

  /** Store / warehouse code */
  @Index
  @Column({ type: DataType.STRING(191), allowNull: false })
  declare location: string;

  /** ISO date of the pickup window (no timezone) */
  @Index
  @Column({ type: DataType.DATEONLY, allowNull: false })
  declare date: string; // YYYY-MM-DD

  /** Start/end of the pickup window (local store time) */
  @Column({ type: DataType.TIME, allowNull: false })
  declare startTime: string; // HH:mm:ss

  @Column({ type: DataType.TIME, allowNull: false })
  declare endTime: string; // HH:mm:ss

  /** How many orders can be booked in this window */
  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
  })
  declare capacity: number;

  /** Optional live counter (can also be derived by counting Orders) */
  @Column({
    type: DataType.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0,
  })
  declare reservedCount: number;

  @Index
  @Column({
    type: DataType.ENUM('open', 'closed'),
    allowNull: false,
    defaultValue: 'open',
  })
  declare status: PickupSlotStatus;

  /** Association: one pickup slot can be referenced by many orders */
  @HasMany(() => OrderModel, {
    foreignKey: 'pickupSlotId',
    sourceKey: 'slotId',
  })
  declare orders?: OrderModel[];

  // timestamps
  declare readonly createdAt: Date;
  declare readonly updatedAt: Date;

  toJSON() {
    const {
      slotId,
      location,
      date,
      startTime,
      endTime,
      capacity,
      reservedCount,
      status,
      createdAt,
      updatedAt,
    } = this.get();
    return {
      slotId,
      location,
      date,
      startTime,
      endTime,
      capacity,
      reservedCount,
      status,
      createdAt,
      updatedAt,
    };
  }
}
