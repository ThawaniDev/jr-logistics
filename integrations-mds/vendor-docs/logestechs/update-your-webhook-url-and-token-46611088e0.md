# Update your webhook URL and token

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /secure/integration/webhook:
    put:
      summary: Update your webhook URL and token
      deprecated: false
      description: >-
        Changes where shipment status updates are sent for the customer that
        owns this API key, and the token sent with them. Every webhook call
        after this one uses the new values. `webhookPassword` replaces the
        current token; leave it empty to stop sending a token.
      operationId: updateWebhook
      tags:
        - Webhooks
        - Webhooks
      parameters:
        - name: X-API-Key
          in: header
          description: The API key issued for this integration.
          required: true
          example: YOUR_API_KEY
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/IntegrationWebhookRequestDto'
            example:
              webhookUrl: https://example.com/logestechs/webhook
              webhookPassword: my-secret-token
      responses:
        '200':
          description: Webhook updated
          headers: {}
          x-apidog-name: ''
        '400':
          description: >-
            Body is missing, or `webhookUrl` is missing or is not a valid
            http/https URL
          headers: {}
          x-apidog-name: ''
        '401':
          description: >-
            Missing, unknown, expired, or disabled API key, or a key issued for
            a different API surface. Body:
            {"status":401,"error":"Unauthorized","message":"<code>","messageKey":"<code>"}.
          headers: {}
          x-apidog-name: ''
      security: []
      x-apidog-folder: Webhooks
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1362857/apis/api-46611088-run
components:
  schemas:
    IntegrationWebhookRequestDto:
      type: object
      description: Where shipment status updates are sent, and the token sent with them
      required:
        - webhookUrl
      properties:
        webhookUrl:
          type: string
          description: >-
            The URL that receives the webhook calls. Must start with http:// or
            https://.
          examples:
            - https://example.com/logestechs/webhook
        webhookPassword:
          type: string
          description: >-
            The token sent with every webhook call. Leave it empty to stop
            sending a token.
          examples:
            - my-secret-token
      x-apidog-orders:
        - webhookUrl
        - webhookPassword
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
