/**
 * README Document Store Tests
 *
 * Tests for @supergrain/store examples from the README:
 * - Setup (DOC_TEST_42)
 * - Finding documents (DOC_TEST_43)
 * - Setting documents (DOC_TEST_44)
 * - React usage (DOC_TEST_45)
 */

import { Store } from "@supergrain/store";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

describe("README Document Store Examples", () => {
  describe("Setup", () => {
    it("#DOC_TEST_42", () => {
      interface DocumentTypes {
        users: { id: number; firstName: string; lastName: string; email: string };
        posts: { id: number; title: string; content: string; userId: number };
      }

      const store = new Store<DocumentTypes>(async (modelType: string, id: string | number) => {
        const response = await fetch(`/api/${modelType}/${id}`);
        return response.json();
      });

      expect(store).toBeInstanceOf(Store);
      expect(typeof store.findDoc).toBe("function");
    });
  });

  describe("Finding Documents", () => {
    it("#DOC_TEST_43", () => {
      interface DocumentTypes {
        posts: { id: number; title: string; content: string; userId: number };
      }

      const store = new Store<DocumentTypes>();

      const doc = store.findDoc("posts", 1);

      expect(doc.content).toBeUndefined();
      expect(doc.isPending).toBe(true);
      expect(doc.isFulfilled).toBe(false);
      expect(doc.isRejected).toBe(false);
    });
  });

  describe("Setting Documents Directly", () => {
    it("#DOC_TEST_44", () => {
      interface DocumentTypes {
        users: { id: number; firstName: string; lastName: string; email: string };
      }

      const store = new Store<DocumentTypes>();

      store.setDocument("users", 1, {
        id: 1,
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
      });

      const user = store.findDoc("users", 1);
      expect(user.isFulfilled).toBe(true);
      expect(user.content).toEqual({
        id: 1,
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
      });
    });
  });

  describe("React Usage", () => {
    it("#DOC_TEST_45", () => {
      interface DocumentTypes {
        users: { id: number; firstName: string; lastName: string; email: string };
        posts: { id: number; title: string; content: string; userId: number };
      }

      const store = new Store<DocumentTypes>();

      function PostView() {
        const post = store.findDoc("posts", 1);
        const user = store.findDoc("users", post.content?.userId as number);

        if (post.isPending) {
          return <div>Loading...</div>;
        }
        if (post.isRejected) {
          return <div>Error loading post</div>;
        }

        return (
          <article>
            <h1>{post.content?.title}</h1>
            {user.content && (
              <p>
                By: {user.content.firstName} {user.content.lastName}
              </p>
            )}
          </article>
        );
      }

      store.setDocument("posts", 1, {
        id: 1,
        title: "Test Post",
        content: "This is a test",
        userId: 2,
      });

      store.setDocument("users", 2, {
        id: 2,
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
      });

      render(<PostView />);

      expect(screen.getByText("Test Post")).toBeInTheDocument();
      expect(screen.getByText("By: Jane Doe")).toBeInTheDocument();
    });
  });
});
