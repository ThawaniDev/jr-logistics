# Overview

Welcome to the **Logestechs API** - the API-key authenticated integration surface for creating and tracking shipments on behalf of a single customer account. It is built for the online stores, ERPs, and warehouse systems that plug into Logestechs directly, so shipments can be created and tracked from your own systems without anyone signing in to the Logestechs portal.

**Base URL:** `https://apisv5.logestechs.com/api`

## Getting your API key

Your key is issued once, from the Logestechs admin portal under **Partners > API Integrations**, when a company admin creates your integration. The full key is shown exactly once, at creation time, so copy it somewhere safe. It cannot be viewed again afterwards, only regenerated.

## Authentication

Every request carries a single header:

```
X-API-Key: psk_integration_xxxxxxxxxxxxxxxxxxxxxxxx
```

- **Scoped to one customer.** A key can only see and act on the packages that belong to the customer account it was issued for, never another customer's data, even within the same company.
- **Fully under your admin's control.** From Partners > API Integrations, a company admin can regenerate, disable, or delete the key at any time, independently of any customer portal password.

## What you can do

- Create a shipment
- Cancel or return a package
- Track a package's current status and full status history
- Generate an AWB PDF for one or more packages
- List the company's address book (regions, cities, villages)
- List the company's service types

Browse **Packages** and **Addresses** in the sidebar for the full endpoint reference, including request/response schemas and try-it examples.
