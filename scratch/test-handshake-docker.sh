#!/bin/bash
# Script de validación del flujo de handshake entre Middle Server y DB Server.
# Verifica que el mecanismo de autenticación funciona correctamente en Docker.
#
# Uso: docker exec -it middle_server_dev sh -c "apk add curl jq && sh /app/scratch/test-handshake-docker.sh"
#   o desde el host (si tienes curl y los puertos expuestos):
#       DB_SERVER_URL=http://localhost:8080 DB_HANDSHAKE_SECRET=<tu_secret> bash test-handshake-docker.sh

set -e

DB_URL="${DB_SERVER_URL:-http://db-server:8080}"
SECRET="${DB_HANDSHAKE_SECRET:-}"

echo "========================================="
echo " Test de Handshake Middle ↔ DB Server"
echo "========================================="
echo ""

if [ -z "$SECRET" ]; then
  echo "❌ ERROR: La variable DB_HANDSHAKE_SECRET no está definida."
  echo "   Establécela antes de ejecutar este script."
  exit 1
fi

echo "🔍 DB Server URL: $DB_URL"
echo ""

# --- Test 1: Handshake con secreto correcto ---
echo "📌 Test 1: Handshake con secreto correcto"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$DB_URL/internal/auth/handshake" \
  -H "Content-Type: application/json" \
  -d "{\"secret\": \"$SECRET\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "   ✅ Handshake exitoso (HTTP 200)"
  # Extraer el token del JSON de respuesta
  TOKEN=$(echo "$BODY" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
  if [ -n "$TOKEN" ]; then
    echo "   ✅ Token JWT recibido (longitud: ${#TOKEN} caracteres)"
  else
    echo "   ❌ No se pudo extraer el token de la respuesta"
    echo "   Respuesta: $BODY"
    exit 1
  fi
else
  echo "   ❌ Handshake fallido (HTTP $HTTP_CODE)"
  echo "   Respuesta: $BODY"
  exit 1
fi

echo ""

# --- Test 2: Petición autenticada con el token ---
echo "📌 Test 2: Petición autenticada (GET /internal/games/active)"
AUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$DB_URL/internal/games/active" \
  -H "Authorization: Bearer $TOKEN")

AUTH_HTTP_CODE=$(echo "$AUTH_RESPONSE" | tail -1)
AUTH_BODY=$(echo "$AUTH_RESPONSE" | head -n -1)

if [ "$AUTH_HTTP_CODE" = "200" ]; then
  echo "   ✅ Petición autenticada exitosa (HTTP 200)"
else
  echo "   ❌ Petición autenticada fallida (HTTP $AUTH_HTTP_CODE)"
  echo "   Respuesta: $AUTH_BODY"
  exit 1
fi

echo ""

# --- Test 3: Petición sin token (debe devolver 401) ---
echo "📌 Test 3: Petición sin token (espera 401)"
NOAUTH_RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$DB_URL/internal/games/active")

NOAUTH_HTTP_CODE=$(echo "$NOAUTH_RESPONSE" | tail -1)

if [ "$NOAUTH_HTTP_CODE" = "401" ]; then
  echo "   ✅ Petición rechazada correctamente (HTTP 401)"
else
  echo "   ❌ Se esperaba HTTP 401, se recibió HTTP $NOAUTH_HTTP_CODE"
  exit 1
fi

echo ""

# --- Test 4: Handshake con secreto incorrecto (debe devolver 401) ---
echo "📌 Test 4: Handshake con secreto incorrecto (espera 401)"
BAD_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$DB_URL/internal/auth/handshake" \
  -H "Content-Type: application/json" \
  -d '{"secret": "este-secreto-es-incorrecto-y-deberia-fallar"}')

BAD_HTTP_CODE=$(echo "$BAD_RESPONSE" | tail -1)

if [ "$BAD_HTTP_CODE" = "401" ]; then
  echo "   ✅ Handshake rechazado correctamente (HTTP 401)"
else
  echo "   ❌ Se esperaba HTTP 401, se recibió HTTP $BAD_HTTP_CODE"
  exit 1
fi

echo ""
echo "========================================="
echo " ✅ Todos los tests de handshake pasados"
echo "========================================="
