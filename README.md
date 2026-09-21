# EliteVolt Systems Business Manager

A browser-based stock, sales-document, invoicing and cash-flow manager for EliteVolt Systems.

## Features
- Google Drive storage using the supplied OAuth client ID and `drive.file` scope.
- Automatic SKU generation for new stock items.
- Customer records with contact person, billing address, shipping address, tax ID and notes.
- Sales documents: Estimates/Quotations, Proforma Invoices and Sales Invoices.
- Unique document IDs/numbers linked to the selected customer.
- Stock is **not deducted** when an estimate, proforma or unpaid invoice is created.
- Stock is deducted when an invoice receives payment/part-payment or when delivery is explicitly confirmed.
- Payment recording on invoices; part-payments update invoice status and cash flow.
- Estimate/proforma conversion to invoice after payment or part-payment.
- Professional A4 print layouts with EliteVolt logo, watermark, customer details, line items, totals, terms and notes.
- Printing no longer forces a blank A4 page before/after a document.
- Settings for company details, registration number, tax/VAT number, tax categories, default tax rate, payment terms, sales contract/terms, document notes, bank/payment details and footer text.
- Cash-flow charts and reporting.

## Deployment
Upload the contents to a static host such as Vercel. Add the deployed origin to the Google OAuth client's Authorized JavaScript origins and enable the Google Drive API in the associated Google Cloud project.
