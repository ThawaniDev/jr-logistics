# Get a package's full status history

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /secure/integration/packages/status/history:
    get:
      summary: Get a package's full status history
      deprecated: false
      description: Provide exactly one of `id`, `barcode`, or `invoice`.
      operationId: getPackageStatusHistory
      tags:
        - Packages
        - Packages
      parameters:
        - name: id
          in: query
          description: Internal package ID
          required: false
          example: 0
          schema:
            type: integer
            format: int64
        - name: barcode
          in: query
          description: Package barcode
          required: false
          example: ''
          schema:
            type: string
        - name: invoice
          in: query
          description: Package invoice number
          required: false
          example: ''
          schema:
            type: string
      responses:
        '200':
          description: Ordered status history
          content:
            '*/*':
              schema:
                type: array
                items: &ref_0
                  $ref: '#/components/schemas/PackageStatusResponse'
          headers: {}
          x-apidog-name: OK
        '400':
          description: No identifier provided
          content:
            '*/*':
              schema:
                type: array
                items: *ref_0
          headers: {}
          x-apidog-name: Bad Request
        '401':
          description: >-
            Missing, unknown, expired, or disabled API key, or a key issued for
            a different API surface. Body:
            {"status":401,"error":"Unauthorized","message":"<code>","messageKey":"<code>"}.
          content:
            '*/*':
              schema:
                type: array
                items: *ref_0
          headers: {}
          x-apidog-name: Unauthorized
        '403':
          description: The requested package belongs to a different customer.
          content:
            '*/*':
              schema:
                type: array
                items: *ref_0
          headers: {}
          x-apidog-name: Forbidden
        '404':
          description: No package matches the given identifier
          content:
            '*/*':
              schema:
                type: array
                items: *ref_0
          headers: {}
          x-apidog-name: Record Not Found
      security: []
      x-apidog-folder: Packages
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1362857/apis/api-42089772-run
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
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    X-API-Key:
      type: apikey
      description: >-
        Every request must carry the API key issued for this integration in the
        X-API-Key header. The company and customer this key belongs to are
        resolved from the key itself — do not send a company-id header or any
        email/password; if a company-id header is sent anyway it is ignored.
      name: X-API-Key
      in: header
servers:
  - url: https://apisv5.logestechs.com/api
    description: Production
security: []

```
