// A customer's email is billing contact info: only the roles that actually
// manage invoicing need it. Every response that embeds a customer record —
// directly, or nested under an order — must redact it for every other role,
// so this is the one place that decision lives.
const CAN_SEE_CUSTOMER_EMAIL = new Set(["ADMIN", "OWNER", "ACCOUNTANT"]);

export function redactCustomerEmail<T extends { email?: string | null }>(role: string, customer: T): T {
  if (CAN_SEE_CUSTOMER_EMAIL.has(role)) return customer;
  return { ...customer, email: undefined };
}

export function redactOrderCustomerEmail<T extends { customer?: { email?: string | null } | null }>(
  role: string,
  record: T,
): T {
  if (CAN_SEE_CUSTOMER_EMAIL.has(role) || !record.customer) return record;
  return { ...record, customer: redactCustomerEmail(role, record.customer) };
}
