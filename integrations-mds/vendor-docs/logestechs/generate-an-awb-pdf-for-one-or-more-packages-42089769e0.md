# Generate an AWB PDF for one or more packages

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /secure/integration/packages/awb:
    post:
      summary: Generate an AWB PDF for one or more packages
      deprecated: false
      description: >-
        Accepts up to 100 identifiers total, mixed across `ids`, `barcodes`, and
        `invoicesNumbers`. Every matched package must belong to this key's
        customer.
      operationId: printMultiplePackagesAwbPdf
      tags:
        - Packages
        - Packages
      parameters:
        - name: timezone
          in: query
          description: IANA timezone used to render dates on the PDF, e.g. Asia/Riyadh
          required: false
          example: ''
          schema:
            type: string
        - name: type
          in: query
          description: >-
            Optional. Label (sticker) size of the AWB PDF. The numbers in the
            name are the label dimensions in centimetres, e.g. `STICKER_10_10` =
            10 cm × 10 cm. If omitted, the company's default AWB layout is used.


            Allowed values (width × height):

            - `STICKER` — 10 × 9 cm

            - `STICKER_10_9` — 10 × 9 cm

            - `STICKER_10_10` — 10 × 10 cm

            - `STICKER_15_10` — 10 × 15 cm (portrait)

            - `STICKER_10_15` — 15 × 10 cm (landscape)

            - `STICKER_6_4` — 4 × 6 cm

            - `STICKER_4_6` — 6 × 4 cm

            - `STICKER_8_16` — 8 × 16 cm

            - `STICKER_8_5` — 5 × 8 cm

            - `STICKER_HALF_A4` — half A4 (21 × 14.8 cm)

            - `STICKER_A6` — A6 label (10.5 cm wide)

            - `QR` — 5 × 5 cm QR label


            Example: `/secure/integration/packages/awb?type=STICKER_10_10`
          required: false
          example: STICKER_10_10
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/PackageIdentifiersWrapper'
            examples: {}
      responses:
        '200':
          description: URL of the generated PDF report
          content:
            '*/*':
              schema:
                type: object
                additionalProperties:
                  type: string
                x-apidog-orders: []
                properties: {}
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: OK
        '400':
          description: >-
            No identifiers provided, invalid ID in the list, or more than 100
            identifiers requested
          content:
            '*/*':
              schema:
                type: object
                additionalProperties:
                  type: string
                x-apidog-orders: []
                properties: {}
                x-apidog-ignore-properties: []
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
                type: object
                additionalProperties:
                  type: string
                x-apidog-orders: []
                properties: {}
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: Unauthorized
        '403':
          description: The requested package belongs to a different customer.
          content:
            '*/*':
              schema:
                type: object
                additionalProperties:
                  type: string
                x-apidog-orders: []
                properties: {}
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: Forbidden
      security: []
      x-apidog-folder: Packages
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1362857/apis/api-42089769-run
components:
  schemas:
    PackageIdentifiersWrapper:
      type: object
      properties:
        ids:
          type: array
          items:
            type: integer
            format: int64
        barcodes:
          type: array
          items:
            type: string
        invoicesNumbers:
          type: array
          items:
            type: string
      x-apidog-orders:
        - ids
        - barcodes
        - invoicesNumbers
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
