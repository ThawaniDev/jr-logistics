# Return a package to sender

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /secure/integration/packages/return:
    put:
      summary: Return a package to sender
      deprecated: false
      description: >-
        Requests a return for a package already out for delivery. Provide
        exactly one of `id`, `barcode`, or `invoice`.
      operationId: returnPackage
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
        - name: timezone
          in: query
          description: IANA timezone used to timestamp the return, e.g. Asia/Riyadh
          required: false
          example: ''
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/NoteMessage'
      responses:
        '200':
          description: Return requested
          headers: {}
          x-apidog-name: OK
        '400':
          description: No identifier provided
          headers: {}
          x-apidog-name: Bad Request
        '401':
          description: >-
            Missing, unknown, expired, or disabled API key, or a key issued for
            a different API surface. Body:
            {"status":401,"error":"Unauthorized","message":"<code>","messageKey":"<code>"}.
          headers: {}
          x-apidog-name: Unauthorized
        '403':
          description: The requested package belongs to a different customer.
          headers: {}
          x-apidog-name: Forbidden
        '404':
          description: No package matches the given identifier
          headers: {}
          x-apidog-name: Record Not Found
      security: []
      x-apidog-folder: Packages
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1362857/apis/api-42089766-run
components:
  schemas:
    NoteMessage:
      type: object
      properties:
        note:
          type: string
        isCostPaid:
          type: boolean
          writeOnly: true
        noteKey:
          type: string
        deliveryProofUrlList:
          type: array
          items:
            type: string
        costPaid:
          type: boolean
      x-apidog-orders:
        - note
        - isCostPaid
        - noteKey
        - deliveryProofUrlList
        - costPaid
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
