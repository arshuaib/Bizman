# EVS-Flow track — Business invoicing & operations

EVS-Flow is a browser-based workspace for EliteVolt Systems in Ghana. It combines a sales dashboard, inventory, customer and supplier records, purchasing, delivery waybills, receipts, credit notes, expenses, cash flow, reports, and print-ready business documents.

## Current capabilities

- Google sign-in and Google Drive JSON storage using the project's existing OAuth client, `drive.file` scope, Drive folder, and data-file identifiers.
- Dashboard with monthly revenue, outstanding receivables, overdue invoice and low-stock counts, 30-day revenue, top products, payment methods, recent invoices, and low-stock alerts.
- Quote/estimate and proforma lifecycle (draft, sent, accepted, expired), direct sales invoice, and conversion to invoice. Invoice creation validates and deducts stock; waybill dispatch records delivery without deducting those same units twice.
- Invoice balances, partial payments, automatic receipts, overdue status, credit notes, reason-required invoice voiding, and retained financial history.
- Sales invoice email and WhatsApp draft links, duplicate-as-quote, live document preview, branded print layouts, and browser Print / Save as PDF.
- Purchase orders, supplier invoices, partial goods receiving, supplier payments, weighted-average item costs, purchase-to-waybill conversion, and standalone waybills / goods-received notes.
- Ghana tax defaults (NHIL 2.5%, GETFund 2.5%, VAT 12.5%) with editable tax categories, and document currency selection for GHS, USD, EUR, and NGN.
- Customer statements, CSV import/export, supplier history, stock adjustments, expenses with small receipt attachments, searchable audit history, report filters, CSV export for Excel, and print-to-PDF reports.
- Global workspace search (Ctrl/Cmd+K), plus searchable, sortable and paginated data tables.
- Ghana demo data available from Settings, including Accra customers such as Kwame Enterprises.

## Run and deploy

This repository is a static HTML/CSS/JavaScript application. Open `index.html` through a local static server or deploy the files to a static host. Google sign-in and Charts load from their existing Google/CDN services, so a network connection is required. Add the deployed origin to the existing OAuth client's authorized JavaScript origins and ensure the Google Drive API is enabled in that Google Cloud project.

The app continues to store the business workspace as a JSON file in Google Drive; existing Drive data remains readable and new collections are migrated with defaults when loaded. Back up the Drive data file before importing bulk records or starting live operations.

## Operational notes

- Invoice stock is deducted when the invoice is created. An outgoing waybill tracks delivery and does not subtract those units again. Voiding an invoice requires a reason; any undelivered quantity deducted at invoice creation is returned.
- Purchase invoice payment and receipt of goods are tracked separately. Partial receipt updates quantities and weighted-average cost.
- Currency totals are not exchanged or consolidated. Dashboard and summary figures use the selected default currency; document records retain their own currency.
- Team-role controls are a UI preview only. This static Drive-backed build has no server-side authorization, database policies, or multi-user audit identity enforcement.
- Printable documents use the browser's print dialog. The current app does not provide server-generated PDFs or a public QR verification service.
- This build preserves the existing Google authentication and Drive wiring. It is not a Next.js/Supabase replatform; production multi-user deployment, secure role enforcement, and public document verification require a backend.
