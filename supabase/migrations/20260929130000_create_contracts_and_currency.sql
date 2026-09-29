-- Migration 20260929130000: Enterprise Contracts Lifecycle & Multi-Currency Support

-- 1. Table contracts for formal B2B agreements, credit limits, price types and payment terms
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id text NOT NULL,
  contract_number text NOT NULL,
  contract_type text NOT NULL DEFAULT 'prepayment' CHECK (contract_type IN ('prepayment', 'deferred_14', 'deferred_30', 'deferred_60', 'consignment')),
  price_type text NOT NULL DEFAULT 'wholesale',
  credit_limit_usd numeric(12,2) NOT NULL DEFAULT 0.00 CHECK (credit_limit_usd >= 0),
  payment_deferral_days integer NOT NULL DEFAULT 0 CHECK (payment_deferral_days >= 0),
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_to date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'suspended', 'terminated', 'expired')),
  allowed_warehouses integer[] DEFAULT '{81}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contracts_partner_id ON contracts(partner_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Clients can view only their own contracts
DROP POLICY IF EXISTS "client_view_own_contracts" ON contracts;
CREATE POLICY "client_view_own_contracts" ON contracts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND (profiles.partner_id = contracts.partner_id OR profiles.role IN ('admin', 'manager_rm', 'manager_lm'))
    )
  );

-- Admins and managers have full management access to contracts
DROP POLICY IF EXISTS "admin_manage_contracts" ON contracts;
CREATE POLICY "admin_manage_contracts" ON contracts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin', 'manager_rm')
    )
  );

-- 2. Multi-currency support on orders table
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'currency'
  ) THEN
    ALTER TABLE orders ADD COLUMN currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'KZT', 'RUB', 'EUR'));
  END IF;
END $$;

-- 3. Add contract_id reference to orders
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'orders' AND column_name = 'contract_id'
  ) THEN
    ALTER TABLE orders ADD COLUMN contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL;
  END IF;
END $$;
