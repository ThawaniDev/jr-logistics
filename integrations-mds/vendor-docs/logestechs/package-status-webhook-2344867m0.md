# Package Status Webhook

Whenever a package assigned to your integration changes status (created, cancelled, returned, delivered, postponed, and more), Logestechs sends an HTTP POST notification to the Webhook URL configured for that integration.

## Configuration

The Webhook URL, Username, and Password are set once per integration in Partners > API Integrations (admin portal), not per request.

## Request

- Method: POST
- Content-Type: application/json

## Authentication headers

The configured Webhook Password is sent as the value of the `Authorization`, `api_key`, `ApiKey`, `api-key`, and `x-api-key` headers (duplicated for compatibility with different receivers). The configured Webhook Username is sent as the value of the `username` and `account_name` headers.

## Payload fields

- `packageId` - internal package ID
- `barcode` - package barcode
- `invoiceNumber` - invoice
- `status` - current tracking status of the package
- `newStatus` - new tracking status, one of the values from List the possible package statuses
- `cod` - cash-on-delivery amount
- `paymentMethod` - payment method
- `time` - when the status changed (ISO date)
- `notes` - optional note attached to the change
- `reason` - reason code, for cancellations or failures
- `driverName` - assigned driver's name
- `driverPhone` - assigned driver's phone
- `signatureUrl` - delivery signature image URL, if available
- `postponedDeliveryDate` - new delivery date, when status is postponed
- `attachmentUrls` - proof-of-delivery attachment URLs, if any
- `pinCode` - delivery PIN code, if applicable

Fields are omitted from the payload when empty.

## Example payload

```json
{
  "packageId": 123456,
  "barcode": "PS000123456",
  "invoiceNumber": "INV-000123",
  "newStatus": "DELIVERED_TO_RECIPIENT",
  "status": "DELIVERED_TO_RECIPIENT",
  "cod": 45.5,
  "paymentMethod": "CASH",
  "time": "2026-08-23T10:15:00.000Z",
  "driverName": "Ahmad",
  "driverPhone": "+9665xxxxxxxx"
}
```

## Notes

- The call is fire-and-forget - Logestechs does not retry failed deliveries. Respond with any 2xx status to acknowledge receipt.
- Use Get a package's current status or Get a package's full status history under Packages to reconcile if a webhook is ever missed.
