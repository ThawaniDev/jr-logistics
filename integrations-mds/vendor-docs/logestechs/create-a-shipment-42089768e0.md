# Create a shipment

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /secure/integration/packages:
    post:
      summary: Create a shipment
      deprecated: false
      description: >-
        Creates a package for the customer that owns this API key. There is no
        email/password or company-id to send — both are resolved from the key.
        The shipment fields, `originAddress` and `destinationAddress` all go
        directly in the request body. If `originAddress` is omitted, the
        customer's own address is used. The service type is always STANDARD. The
        delivery cost is always calculated from the customer's shipping rates.


        **Addresses** — identify the location with any one of `villageId`,
        `cityId`, `village` (name) or `city` (name), or send several. Missing
        ids are filled in automatically.


        Minimal example:

        ```json

        {
          "receiverName": "Ahmad Ali",
          "receiverPhone": "0599999999",
          "shipmentType": "COD",
          "cod": 100,
          "destinationAddress": {
            "addressLine1": "King Fahd Road, Building 12",
            "city": "Riyadh"
          }
        }

        ```
      operationId: addPackage
      tags:
        - Packages
        - Packages
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/IntegrationPackageRequestDto'
            example:
              receiverName: Ahmad Ali
              receiverPhone: '0599999999'
              shipmentType: COD
              cod: 100
              destinationAddress:
                addressLine1: King Fahd Road, Building 12
                city: Riyadh
      responses:
        '200':
          description: Package created
          content:
            '*/*':
              schema:
                type: object
                properties: {}
                x-apidog-orders: []
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: OK
        '400':
          description: >-
            Body or `destinationAddress` is missing, an address has no
            village/city, a `city`/`village` name matches nothing, or the
            payload is otherwise invalid
          content:
            '*/*':
              schema:
                type: object
                properties: {}
                x-apidog-orders: []
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
                properties: {}
                x-apidog-orders: []
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: Unauthorized
      security: []
      x-apidog-folder: Packages
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1362857/apis/api-42089768-run
components:
  schemas:
    IntegrationPackageRequestDto:
      type: object
      description: >-
        Shipment data, including where it is picked up from and where it is
        delivered to
      properties:
        originAddress: &ref_0
          $ref: '#/components/schemas/IntegrationAddressDto'
          description: >-
            Where the shipment is picked up from. Leave it out to use your
            account's address.
        destinationAddress: *ref_0
        receiverName:
          type: string
          description: Receiver Name
          examples:
            - XXX YYYY
        receiverPhone:
          type: string
          description: Receiver Phone
          examples:
            - '0123456789'
        receiverPhone2:
          type: string
          description: Additional Receiver Phone
          examples:
            - '0123456789'
        senderName:
          type: string
          description: Sender Name. Defaults to your account name.
          examples:
            - XXX YYYY
        senderPhone:
          type: string
          description: Sender Phone. Defaults to your account phone.
          examples:
            - '0123456789'
        shipmentType:
          type: string
          description: Shipment type
          enum:
            - COD
            - REGULAR
            - SWAP
            - BRING
          examples:
            - COD
        cod:
          type: number
          format: double
          description: Cash on delivery (Including delivery cost)
          examples:
            - 10
        paymentType:
          type: string
          description: >-
            COD collection method, for companies WITHOUT custom payment types.
            If the company has custom payment types, send `paymentTypeId`
            instead. Defaults to CASH; ignored for REGULAR shipments.
          enum:
            - CASH
            - CHEQUE
            - BANK_TRANSFER
            - PREPAID
            - DIGITAL_WALLET
            - CARD
            - MADA
            - VISA
            - MASTER
            - CLICK_PAY
            - INTER_PAY
            - INTER_PAY_BY_LINK
            - NEAR_PAY
            - TAP_PAY
            - PAY_MOB
            - SAAD_PAY
            - ZAIN_CASH
            - ORANGE_MONEY
            - DINARAK
            - ARAB_BANK
            - OTHERS
            - MULTI
          examples:
            - CASH
        paymentTypeId:
          type: integer
          format: int64
          description: >-
            Only for companies WITH custom payment types: the payment type id.
            If omitted, the company's default payment type is used. Otherwise
            leave it out and send `paymentType`.
        toCollectFromReceiver:
          type: string
          description: >-
            Money amount to be collected from receiver if shipmentType is SWAP
            or BRING
          examples:
            - '200'
        toPayToReceiver:
          type: string
          description: Money amount to be paid to receiver if shipmentType is SWAP or BRING
          examples:
            - '15'
        description:
          type: string
          description: Content Description
        notes:
          type: string
          description: Notes in general for packages
        invoiceNumber:
          type: string
          description: Another unique identifier for packages. Accepts alphanumeric values.
          examples:
            - INV-11111222
        quantity:
          type: integer
          format: int32
          description: Quantity
          examples:
            - 1
        weight:
          type: number
          format: double
          description: >-
            Weight in kg. Affects the price only if the company prices by weight
            (pricing per kg) or uses volumetric weight.
          examples:
            - 1
        width:
          type: number
          format: double
          description: >-
            Width in cm. Only needed if the company uses volumetric weight;
            otherwise leave it out. Ignored when `parcelTypeId` is sent (the
            parcel type's dimensions are used).
          examples:
            - 10
        length:
          type: number
          format: double
          description: >-
            Length in cm. Only needed if the company uses volumetric weight;
            otherwise leave it out. Ignored when `parcelTypeId` is sent (the
            parcel type's dimensions are used).
          examples:
            - 10
        height:
          type: number
          format: double
          description: >-
            Height in cm. Only needed if the company uses volumetric weight;
            otherwise leave it out. Ignored when `parcelTypeId` is sent (the
            parcel type's dimensions are used).
          examples:
            - 10
        parcelTypeId:
          type: integer
          format: int64
          description: >-
            Optional: an `id` from GET /parcel-types. Its dimensions replace
            width/length/height, and its weight is used if `weight` is 0.
          examples:
            - 5
        serviceTypeId:
          type: integer
          format: int64
          description: >-
            Only for companies WITH dynamic service types: an `id` from GET
            /packages/service-type. Otherwise leave it out — the service type is
            always STANDARD.
          examples:
            - 12
        vehicleTypeId:
          type: integer
          format: int64
          description: >-
            Only for companies WITH dynamic service types: an `id` from GET
            /vehicle-types.
          examples:
            - 3
        packageItemsToDeliverList:
          type: array
          description: >-
            Items in the package (also accepted as `items`). Only stored if the
            company supports partial delivery of package items; otherwise
            ignored.
          items:
            type: object
            properties: {}
            x-apidog-orders: []
            x-apidog-ignore-properties: []
        webhookUrl:
          type: string
          description: Optional URL that receives this package's status changes
        attachmentUrl:
          type: string
          description: >-
            Public http(s) URL of an image or PDF to attach to the package. The
            file is downloaded when the package is created; if it cannot be
            retrieved the request fails with 400 and no package is created.
      required:
        - destinationAddress
        - receiverName
        - receiverPhone
        - shipmentType
        - cod
      x-apidog-orders:
        - originAddress
        - destinationAddress
        - receiverName
        - receiverPhone
        - receiverPhone2
        - senderName
        - senderPhone
        - shipmentType
        - cod
        - paymentType
        - paymentTypeId
        - toCollectFromReceiver
        - toPayToReceiver
        - description
        - notes
        - invoiceNumber
        - quantity
        - weight
        - width
        - length
        - height
        - parcelTypeId
        - serviceTypeId
        - vehicleTypeId
        - packageItemsToDeliverList
        - webhookUrl
        - attachmentUrl
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
    IntegrationAddressDto:
      type: object
      description: >-
        Address. Identify the location with ANY ONE of: `villageId`, `cityId`,
        `village` (name) or `city` (name) — or send several of them. Missing ids
        are resolved automatically: a village gives its city and region, a city
        gives its region. Names match the English or Arabic name exactly. If a
        village name exists in more than one city, also send `city` or `cityId`.
      properties:
        addressLine1:
          type: string
          description: Street, building and apartment
          examples:
            - 123 Main Street, Apartment 2
        addressLine2:
          type: string
          description: Extra address details
          examples:
            - Near the central mosque
        villageId:
          type: integer
          format: int64
          description: Village / district id from GET /address/villages
          examples:
            - 18150
        cityId:
          type: integer
          format: int64
          description: City id from GET /address/cities
          examples:
            - 6824
        regionId:
          type: integer
          format: int64
          description: Optional — resolved from the city when omitted
          examples:
            - 395
        village:
          type: string
          description: Village / district name, used when `villageId` is not sent
          examples:
            - Al Olaya
        city:
          type: string
          description: City name, used when `cityId` is not sent
          examples:
            - Riyadh
        latitude:
          type: number
          format: double
          examples:
            - 24.7136
        longitude:
          type: number
          format: double
          examples:
            - 46.6753
        shortAddress:
          type: string
          description: Saudi national short address
          examples:
            - RRRD2929
      required:
        - addressLine1
      x-apidog-orders:
        - addressLine1
        - addressLine2
        - villageId
        - cityId
        - regionId
        - village
        - city
        - latitude
        - longitude
        - shortAddress
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
