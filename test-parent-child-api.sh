#!/bin/bash

# Test script for Parent-Child Registration API
# Tests all new endpoints with real credentials

echo "🧪 Parent-Child Registration API Tests"
echo "========================================"
echo ""

# Load test credentials
if [ -f "scripts/test-credentials.sh" ]; then
  source scripts/test-credentials.sh
else
  echo "⚠️  Test credentials file not found, using defaults"
  STUDENT_EMAIL="test-student@mondo.local"
  STUDENT_PASSWORD="TestStudent2027"
fi

API_URL="http://localhost:5000"
COOKIES_FILE="/tmp/portal-cookies.txt"

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Helper function to test endpoint
test_endpoint() {
  local name="$1"
  local method="$2"
  local endpoint="$3"
  local data="$4"
  local expected_code="$5"

  echo -n "Testing: $name ... "

  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" -b "$COOKIES_FILE" "$API_URL$endpoint")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" \
      -H "Content-Type: application/json" \
      -b "$COOKIES_FILE" \
      -d "$data" \
      "$API_URL$endpoint")
  fi

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | head -n-1)

  if [ "$http_code" = "$expected_code" ]; then
    echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code)"
    ((TESTS_PASSED++))
    return 0
  else
    echo -e "${RED}✗ FAIL${NC} (Expected $expected_code, got $http_code)"
    echo "   Response: $body"
    ((TESTS_FAILED++))
    return 1
  fi
}

# Step 1: Login
echo "Step 1: Login to Student Portal"
echo "--------------------------------"

login_response=$(curl -s -c "$COOKIES_FILE" -X POST \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$STUDENT_EMAIL\",\"password\":\"$STUDENT_PASSWORD\"}" \
  "$API_URL/api/portal/auth/login")

if echo "$login_response" | grep -q '"user"'; then
  echo -e "${GREEN}✓ Login successful${NC}"
  echo ""
else
  echo -e "${RED}✗ Login failed${NC}"
  echo "Response: $login_response"
  echo ""
  echo "Please ensure:"
  echo "1. Backend is running (port 5000)"
  echo "2. Test user exists: $STUDENT_EMAIL"
  echo "3. MongoDB is running"
  exit 1
fi

# Step 2: Children Management API
echo "Step 2: Children Management API"
echo "--------------------------------"

# Get children (should be empty initially)
test_endpoint "GET /api/portal/children (empty)" \
  "GET" "/api/portal/children" "" "200"

# Add first child
test_endpoint "POST /api/portal/children (Anna)" \
  "POST" "/api/portal/children" \
  '{"firstName":"Anna","lastName":"Test","birthdate":"2014-05-20","phone":"+49123456789"}' \
  "201"

# Add second child
test_endpoint "POST /api/portal/children (Tim)" \
  "POST" "/api/portal/children" \
  '{"firstName":"Tim","lastName":"Test","birthdate":"2016-03-10"}' \
  "201"

# Get children (should have 2 now)
children_response=$(curl -s -b "$COOKIES_FILE" "$API_URL/api/portal/children")
children_count=$(echo "$children_response" | grep -o '"firstName"' | wc -l)

if [ "$children_count" -eq 2 ]; then
  echo -e "Children count: ${GREEN}✓ 2 children${NC}"
  ((TESTS_PASSED++))

  # Extract first child ID for update/delete tests
  CHILD_ID=$(echo "$children_response" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  echo "  Extracted child ID: $CHILD_ID"
else
  echo -e "Children count: ${RED}✗ Expected 2, got $children_count${NC}"
  ((TESTS_FAILED++))
fi

echo ""

# Step 3: Update child
echo "Step 3: Update/Delete Operations"
echo "---------------------------------"

if [ -n "$CHILD_ID" ]; then
  test_endpoint "PUT /api/portal/children/:id" \
    "PUT" "/api/portal/children/$CHILD_ID" \
    '{"phone":"+49987654321"}' \
    "200"

  test_endpoint "DELETE /api/portal/children/:id" \
    "DELETE" "/api/portal/children/$CHILD_ID" \
    "" "200"
else
  echo -e "${YELLOW}⊘ Skipped (no child ID)${NC}"
fi

echo ""

# Step 4: Validation Tests
echo "Step 4: Validation Tests"
echo "------------------------"

# Test child too old (age >= 18)
test_endpoint "Age validation (too old)" \
  "POST" "/api/portal/children" \
  '{"firstName":"Adult","lastName":"Test","birthdate":"1990-01-01"}' \
  "400"

# Test duplicate child name
test_endpoint "Duplicate name validation" \
  "POST" "/api/portal/children" \
  '{"firstName":"Tim","lastName":"Test","birthdate":"2016-03-10"}' \
  "400"

# Test missing required fields
test_endpoint "Missing fields validation" \
  "POST" "/api/portal/children" \
  '{"firstName":"Incomplete"}' \
  "400"

echo ""

# Step 5: Seasonal Registrations (if active period exists)
echo "Step 5: Seasonal Registrations API"
echo "-----------------------------------"

# Check for active period
period_response=$(curl -s -b "$COOKIES_FILE" "$API_URL/api/portal/seasonal-registrations/active-period")

if echo "$period_response" | grep -q '"period":{'; then
  echo -e "${GREEN}✓ Active registration period found${NC}"

  # Test plural endpoint
  test_endpoint "GET /api/portal/seasonal-registrations/my-registrations" \
    "GET" "/api/portal/seasonal-registrations/my-registrations?periodId=invalid" \
    "" "200"
else
  echo -e "${YELLOW}⊘ No active period (skipping registration tests)${NC}"
fi

echo ""

# Step 6: Cleanup
echo "Step 6: Cleanup"
echo "---------------"

# Re-fetch children to get current IDs
cleanup_response=$(curl -s -b "$COOKIES_FILE" "$API_URL/api/portal/children")
child_ids=$(echo "$cleanup_response" | grep -o '"_id":"[^"]*"' | cut -d'"' -f4)

if [ -n "$child_ids" ]; then
  echo "Cleaning up test children..."
  for id in $child_ids; do
    curl -s -X DELETE -b "$COOKIES_FILE" "$API_URL/api/portal/children/$id" > /dev/null
    echo "  Deleted child: $id"
  done
  echo -e "${GREEN}✓ Cleanup complete${NC}"
else
  echo "No children to clean up"
fi

# Remove cookies file
rm -f "$COOKIES_FILE"

echo ""

# Summary
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo "Total:  $((TESTS_PASSED + TESTS_FAILED))"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some tests failed${NC}"
  exit 1
fi
