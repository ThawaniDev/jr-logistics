#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

## user_problem_statement: Build and verify the JR Logistics Saudi Arabic-first logistics marketplace with business, driver, courier office, admin, staff, escrow settlement, verification, operations and multi-tab session flows.
## backend:
##   - task: "Iteration 10-12 backend regression"
##     implemented: true
##     working: true
##     file: "/app/backend/tests/test_iteration10.py, /app/backend/tests/test_iteration11.py, /app/backend/tests/test_iteration12.py"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: false
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Ran python -m pytest backend/tests/test_iteration10.py backend/tests/test_iteration11.py backend/tests/test_iteration12.py -q; 17/17 passed."
## frontend:
##   - task: "Iteration 12 UX fixes: onboarding banners, wizard verification gate, translation key leaks, StatusBadge namespaces"
##     implemented: true
##     working: true
##     file: "/app/frontend/src/components/OnboardingBanner.jsx, /app/frontend/src/components/StatusBadge.jsx, /app/frontend/src/pages/business/BusinessDashboard.jsx, /app/frontend/src/pages/worker/WorkerDashboard.jsx, /app/frontend/src/pages/business/RequestNew.jsx, /app/frontend/src/pages/admin/AdminOffices.jsx, /app/frontend/src/i18n/translations.js"
##     stuck_count: 0
##     priority: "high"
##     needs_retesting: true
##     status_history:
##         -working: true
##         -agent: "main"
##         -comment: "Confirmed prior iteration-12 fixes are present; added missing office/doc/settlement translation namespaces, mounted dashboard onboarding banners, and added a full wizard verification block for pending businesses. Removed duplicate fin status translation keys before retest."
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 13
##   run_ui: true
## test_plan:
##   current_focus:
##     - "Retest iteration-12 frontend issues from /app/test_reports/iteration_12.json"
##     - "Verify business dashboard onboarding banner and wizard verification gate"
##     - "Verify office/admin surfaces have no raw i18n keys"
##     - "Re-run office linking and settlement ownership UI flows not exercised in iteration 12"
##   stuck_tasks: []
##   test_all: false
##   test_priority: "high_first"
## agent_communication:
##     -agent: "main"
##     -message: "Backend regression is green (17/17). Please focus frontend E2E retesting on iteration_12 action items, then exercise driver linking and office settlement ownership in UI. Use credentials from /app/memory/test_credentials.md; OTP demo codes are returned by /api/auth/otp/send. Document cloud upload remains externally blocked only if the Universal Key is still inactive; local upload fallback should still work."
