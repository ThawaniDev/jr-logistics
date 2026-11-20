# List the company's address book

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /secure/integration/address/cities:
    get:
      summary: List the company's address book
      deprecated: false
      description: >-
        Regions, cities, and villages configured for this company — use these
        IDs when filling in `originAddress`/`destinationAddress` on a shipment.
      operationId: getCitiesList
      tags:
        - Addresses
        - Packages
      parameters: []
      responses:
        '200':
          description: City list
          content:
            '*/*':
              schema:
                type: array
                items: &ref_0
                  $ref: '#/components/schemas/City'
          headers: {}
          x-apidog-name: OK
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
      security: []
      x-apidog-folder: Addresses
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1362857/apis/api-42089773-run
components:
  schemas:
    City:
      type: object
      properties:
        createdDate:
          type: string
          format: date-time
        id:
          type: integer
          format: int64
        companyId:
          type: integer
          format: int64
        name:
          type: string
        arabicName:
          type: string
        englishName:
          type: string
        regionId:
          type: integer
          format: int64
        hubId:
          type: integer
          format: int64
        isSelected:
          type: boolean
        isAddedByUser:
          type: boolean
        prefix:
          type: string
        color:
          type: string
        arabicRegionName:
          type: string
        regionName:
          type: string
        countryCode:
          type: string
        geofenceData:
          $ref: '#/components/schemas/GeofenceData'
        geofenceDataId:
          type: integer
          format: int64
      x-apidog-orders:
        - createdDate
        - id
        - companyId
        - name
        - arabicName
        - englishName
        - regionId
        - hubId
        - isSelected
        - isAddedByUser
        - prefix
        - color
        - arabicRegionName
        - regionName
        - countryCode
        - geofenceData
        - geofenceDataId
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
    GeofenceData:
      type: object
      properties:
        createdDate:
          type: string
          format: date-time
        id:
          type: integer
          format: int64
        companyId:
          type: integer
          format: int64
        geofenceColor:
          type: string
        geofencePoints:
          type: array
          items:
            type: array
            items:
              type: number
              format: double
        type:
          type: string
          enum:
            - COMPANIES_VILLAGE
            - COMPANIES_CITY
            - COMPANIES_REGION
            - HUB_WORKING_AREA
        geofence:
          type: string
      x-apidog-orders:
        - createdDate
        - id
        - companyId
        - geofenceColor
        - geofencePoints
        - type
        - geofence
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
