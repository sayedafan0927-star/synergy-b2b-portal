/*
# Add show_stock_summary column to client_warehouse_rules
1. Schema Additions:
   - Add `show_stock_summary` (boolean, default false) to `client_warehouse_rules`.
   - Allows administrators to grant specific clients visibility into warehouse stock summary & reservations.
*/

ALTER TABLE client_warehouse_rules 
ADD COLUMN IF NOT EXISTS show_stock_summary boolean NOT NULL DEFAULT false;
