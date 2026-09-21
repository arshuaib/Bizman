# EliteVolt Systems Business Manager

A mobile-friendly, browser-based business management app for EliteVolt Systems.

## Included
- Stock/inventory management
- Automatic SKU generation for new products (category + product name + unique sequence)
- Automatic stock deduction when a sale is saved
- Low-stock and out-of-stock monitoring
- Sales invoices and payment receipts
- Professional A4 print layout using the supplied EliteVolt logo as letterhead and a subtle watermark
- Customer records
- Cash-in / cash-out tracking
- Cash-flow trend charts
- Sales/category chart
- Printable inventory/business report
- Google Drive storage using the supplied OAuth 2.0 Web Client ID
- Responsive mobile navigation

## Google Drive setup

The app uses the Google Drive API with the `drive.file` scope. Google documents this as a narrow scope that allows an app to create, edit and delete only files it uses, rather than giving the app broad access to the user's entire Drive.

1. In Google Cloud Console, enable **Google Drive API** for the project that owns the OAuth client.
2. Configure the Google Auth platform / OAuth consent screen.
3. Add your deployment origin under **Authorized JavaScript origins** for the Web application OAuth client.
4. Deploy this folder to your hosting provider.
5. Open the deployed site and click **Connect Google Drive**.
6. Grant permission.
7. The app creates a Drive folder called `EliteVolt Systems Data` and stores `elitevolt-data.json` inside it.
8. Changes are automatically synced after edits/sales/transactions.

## Important
The client ID is safe to include in a browser application, but OAuth configuration must restrict the authorized JavaScript origins to the domains you actually use. Do not put a Google client secret in this project.

## Local testing

Because Google OAuth requires an origin, use a local web server rather than opening `index.html` directly.

For example:

```bash
python -m http.server 8000
```

Then open:

`http://localhost:8000`

Add `http://localhost:8000` to the OAuth client's Authorized JavaScript origins for local testing.

## Data model

The Drive JSON file contains:
- `products`
- `customers`
- `invoices`
- `transactions`
- `settings`

The app can be extended later with purchasing, suppliers, expenses, user roles, VAT calculations, barcode scanning, product images, PDF generation, and multi-user controls.
