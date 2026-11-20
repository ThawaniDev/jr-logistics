# List the possible package statuses

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /secure/integration/packages/statuses:
    get:
      summary: List the possible package statuses
      deprecated: false
      description: >-
        Static reference data — the full set of statuses a package can be in,
        with English and Arabic labels. Does not require a specific package.
      operationId: getPackageStatuses
      tags:
        - Packages
        - Packages
      parameters: []
      responses:
        '200':
          description: Status list
          content:
            '*/*':
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/LocalizedKeyData'
          headers: {}
          x-apidog-name: OK
      security: []
      x-apidog-folder: Packages
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1362857/apis/api-42089770-run
components:
  schemas:
    LocalizedKeyData:
      type: object
      properties:
        key:
          type: string
        englishValue:
          type: string
        arabicValue:
          type: string
      x-apidog-orders:
        - key
        - englishValue
        - arabicValue
      x--orders:
        - key
        - englishValue
        - arabicValue
      x--ignore-properties: []
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
