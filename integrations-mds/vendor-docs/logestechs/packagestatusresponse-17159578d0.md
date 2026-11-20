# PackageStatusResponse

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths: {}
components:
  schemas:
    PackageStatusResponse:
      type: object
      properties:
        packageId:
          type: integer
          format: int64
        changedById:
          type: integer
          format: int64
        changedBy:
          type: string
        createdDate:
          type: string
          format: date-time
        companyId:
          type: integer
          format: int64
        packageTrackingStatus:
          type: string
        statusKey:
          type: string
        failedStatus:
          type: string
        integrationSource:
          type: string
          enum:
            - ZID
            - SALLA
            - OTO
            - FASTCOO_APP
            - NAOURI
            - TOROD
            - EXCEL
            - FULFILLMENT
            - MANUAL
            - TRANSFER
            - INTEGRATION
            - SHOPIFY
            - PARTNER
            - WOOCOMMERCE
            - PIK
            - BY_ADMIN
            - BY_CUSTOMER
            - ZID_REFRIGERATED
            - MADAR
            - NUPCO
            - AJEX
            - OLIVERY
            - REDBOX
            - STARLINK
            - OPENCART
            - SMSA
            - CARRIYO
            - TAIAR
            - MARKETING_CAMPAIGN
            - PUBLIC_LINK
            - ZAIN
            - IMILE
            - SOCIAL_SELLER
            - DAMAGED_PRODUCTS_REQUEST
            - ARAMEX
            - BREAKDOWN
            - CYCLE_COUNT
            - DELIVERECT
      x-apidog-orders:
        - packageId
        - changedById
        - changedBy
        - createdDate
        - companyId
        - packageTrackingStatus
        - statusKey
        - failedStatus
        - integrationSource
      x-apidog-folder: ''
  securitySchemes: {}
servers:
  - url: https://apisv5.logestechs.com/api
    description: Production
security: []

```
