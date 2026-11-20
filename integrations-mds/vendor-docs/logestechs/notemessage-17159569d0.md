# NoteMessage

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
      x-apidog-folder: ''
  securitySchemes: {}
servers:
  - url: https://apisv5.logestechs.com/api
    description: Production
security: []

```
