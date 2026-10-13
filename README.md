# EliteVolt Systems Business Manager

A browser-based stock, sales-document, invoicing and cash-flow manager for EliteVolt Systems.

## Features
- Google Drive storage using the supplied OAuth client ID and `drive.file` scope.
- Automatic SKU generation for new stock items.
- Customer records with contact person, billing address, shipping address, tax ID and notes.
- Sales documents: Estimates/Quotations, Proforma Invoices and Sales Invoices.
- Supplier directory, purchase orders and purchase invoices with payment tracking.
- Partial goods receiving from supplier invoices or purchase orders, with inventory and weighted-average unit cost updates.
- Outgoing delivery waybills and incoming goods-received notes created from sales invoices, purchase documents, or from scratch.
- Partial dispatch/receiving on waybills, with linked invoice and inventory status updates.
- Unique document IDs/numbers linked to the selected customer.
- Stock is **not deducted** when an estimate, proforma or unpaid invoice is created.
- Stock is deducted when an invoice receives payment/part-payment or when delivery is explicitly confirmed.
- Payment recording on invoices; part-payments update invoice status and cash flow.
- Estimate/proforma conversion to invoice after payment or part-payment.
- Modern A4 print layouts for quotes/estimates, proformas, sales invoices, supplier documents and waybills, with company branding, party details, line items, totals, terms and signature fields.
- Printing no longer forces a blank A4 page before/after a document.
- Settings for company details, registration number, tax/VAT number, tax categories, default tax rate, payment terms, sales contract/terms, document notes, bank/payment details and footer text.
- Cash-flow charts and reporting.

## Deployment
Upload the contents to a static host such as Vercel. Add the deployed origin to the Google OAuth client's Authorized JavaScript origins and enable the Google Drive API in the associated Google Cloud project.

## Sales / ERP workflow update
- New sales begin as Quotations.
- Quotations can be converted to Proforma Invoices or Sales Invoices.
- Formal sales documents require a saved customer; walk-in customers are not used for new documents.
- Delivery and installation/labour charges can be entered per document.
- Configured tax categories are automatically applied together and printed separately (for example VAT 15%, NHIL 2.5%, GETFund 2.5%).
- Payments do not deduct physical stock. A paid or part-paid invoice reserves the ordered quantities until delivery is confirmed.
- Confirming delivery is the stock-reduction event.
- Stock screens show on-hand, reserved and available quantities, and invoice creation checks available quantities before reserving stock.

## Purchasing and waybill workflow
- Create supplier purchase orders, then record purchase invoices against those orders or directly from a supplier bill.
- Purchase invoice payments appear as cash-out transactions. Receiving stock is a separate action and supports partial deliveries.
- Receiving updates on-hand quantity and weighted-average item cost. A purchase document can also be converted into an incoming waybill.
- Sales invoices can be converted into outgoing waybills. Completing a waybill updates delivered quantities and deducts stock; partial deliveries remain tracked on the invoice.
- Standalone waybills support manual movements when there is no linked invoice or purchase document.
- New document collections are added to the existing Drive JSON data file. Existing records and the Google Drive sign-in configuration remain compatible.
