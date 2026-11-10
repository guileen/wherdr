.PHONY: test

test:
	@npm run test -- $(TEST_ARGS) --reporter=dot
	@npm run typecheck
