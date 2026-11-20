# PackageIdentifiersWrapper

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
      x-apidog-folder: ''
  securitySchemes: {}
servers:
  - url: https://apisv5.logestechs.com/api
    description: Production
security: []

```
