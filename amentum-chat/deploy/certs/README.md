# Corporate certificates

Put PEM-encoded root/intermediate CA certificates here with a `.crt` extension, e.g.
`amentum-root-ca.crt` for the Amentum TLS-inspection proxy.

* **Build time** – `Dockerfile` and `sandbox.Dockerfile` add every `*.crt` in this folder to the
  image trust store, so `pip`, `npm` and `apt` work behind TLS inspection.
* **Run time** – `docker-compose.gcchigh.yml` mounts this folder at `/certs`; set
  `OUTBOUND_CA_BUNDLE=/certs/amentum-root-ca.crt` so calls to Azure OpenAI trust the proxy.
  Entra ID certificate credentials (`AZURE_CLIENT_CERTIFICATE_PATH`) can live here too.

Everything in this folder except this README is git-ignored.
