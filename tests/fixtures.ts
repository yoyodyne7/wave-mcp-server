const cad = (value: string) => ({ value, currency: { code: "CAD" } });

export function rawInvoice(over: Record<string, unknown> = {}) {
  return {
    id: "INV1",
    invoiceNumber: "42",
    status: "SAVED",
    title: "Invoice",
    subhead: null,
    poNumber: null,
    invoiceDate: "2026-10-01",
    dueDate: "2026-10-31",
    modifiedAt: "2026-10-08T12:00:00Z",
    memo: null,
    footer: null,
    pdfUrl: "https://wave.test/inv1.pdf",
    viewUrl: "https://wave.test/inv1",
    exchangeRate: 1,
    customer: { id: "C1", name: "Acme Paints", email: "ana@acme.test" },
    currency: { code: "CAD" },
    total: cad("1,130.00"),
    amountDue: cad("1,130.00"),
    amountPaid: cad("0.00"),
    taxTotal: cad("130.00"),
    items: [
      {
        description: "October retainer",
        quantity: 1,
        unitPrice: 1000,
        subtotal: cad("1,000.00"),
        total: cad("1,130.00"),
        product: { id: "P1", name: "Content retainer" },
        taxes: [{ amount: cad("130.00"), salesTax: { id: "T1", abbreviation: "HST", rate: "0.13" } }],
      },
    ],
    payments: [],
    ...over,
  };
}

export function rawCustomer(over: Record<string, unknown> = {}) {
  return {
    id: "C1", name: "Acme Paints", firstName: null, lastName: null, email: "ana@acme.test", phone: null,
    isArchived: false, currency: { code: "CAD" }, address: null,
    outstandingAmount: cad("0.00"), overdueAmount: cad("0.00"),
    ...over,
  };
}
