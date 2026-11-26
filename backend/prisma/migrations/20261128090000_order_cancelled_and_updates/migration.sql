-- An order whose invoice is credit-noted before dispatch is CANCELLED, which
-- releases the stock its approval set aside. ORDER_UPDATE tells people when
-- an order moves to its next stage.
ALTER TYPE "SalesOrderStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_UPDATE';
