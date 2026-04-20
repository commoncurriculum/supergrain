import { describe, it, expect } from "vitest";

import { createReactive, update, effect, computed } from "../../src";

describe("Deep Nesting Operations (Type Safe)", () => {
  // Helper to safely access deeply nested properties (not used but kept for future reference)
  // const safeAccess = <T>(getter: () => T): T => {
  //   try {
  //     return getter()
  //   } catch {
  //     throw new Error('Unexpected undefined value in test')
  //   }
  // }

  // Complex nested data structure for comprehensive testing
  const createComplexStore = () => {
    const state = createReactive({
      organization: {
        id: "org-1",
        name: "TechCorp",
        departments: [
          {
            id: "dept-1",
            name: "Engineering",
            budget: 500000,
            teams: [
              {
                id: "team-1",
                name: "Backend Team",
                members: [
                  {
                    id: "emp-1",
                    name: "Alice Johnson",
                    role: "Senior Developer",
                    skills: ["Node.js", "PostgreSQL", "Docker"],
                    projects: [
                      {
                        id: "proj-1",
                        name: "API Redesign",
                        status: "active",
                        tasks: [
                          {
                            id: "task-1",
                            title: "Database Migration",
                            completed: false,
                          },
                          {
                            id: "task-2",
                            title: "API Documentation",
                            completed: true,
                          },
                        ],
                        metadata: {
                          priority: "high",
                          resources: {
                            tools: {
                              deployment: {
                                platform: "AWS",
                                regions: ["us-east-1", "us-west-2"],
                                config: {
                                  instances: 3,
                                  autoscaling: {
                                    enabled: true,
                                    min: 2,
                                    max: 10,
                                    triggers: {
                                      cpu: { threshold: 70, duration: 300 },
                                      memory: { threshold: 80, duration: 180 },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    ],
                    contact: {
                      email: "alice@techcorp.com",
                      phone: "+1234567891",
                      address: {
                        street: "123 Tech St",
                        city: "San Francisco",
                        state: "CA",
                        zip: "94105",
                        coordinates: { lat: 37.7749, lng: -122.4194 },
                      },
                    },
                  },
                  {
                    id: "emp-2",
                    name: "Bob Smith",
                    role: "DevOps Engineer",
                    skills: ["Kubernetes", "Terraform", "Python"],
                    projects: [] as any[],
                    contact: {
                      email: "bob@techcorp.com",
                      phone: "+1234567892",
                      address: {
                        street: "456 Dev Ave",
                        city: "Austin",
                        state: "TX",
                        zip: "78701",
                        coordinates: { lat: 30.2672, lng: -97.7431 },
                      },
                    },
                  },
                ],
                resources: {
                  budget: 150000,
                  tools: ["Jira", "Slack", "GitHub"],
                },
              },
              {
                id: "team-2",
                name: "Frontend Team",
                members: [] as any[],
                resources: {
                  budget: 120000,
                  tools: ["Figma", "Slack", "GitHub"],
                },
              },
            ],
            metrics: {
              performance: {
                velocity: 85,
                quality: 92,
                satisfaction: 88,
              },
            },
          },
          {
            id: "dept-2",
            name: "Marketing",
            budget: 200000,
            teams: [] as any[],
            metrics: {
              performance: {
                leads: 450,
                conversions: 67,
                engagement: 73,
              },
            },
          },
        ],
      },
    });

    // Type assertion helpers for safe access
    const getDept = (index: number) => state.organization.departments[index]!;
    const getTeam = (deptIndex: number, teamIndex: number) => getDept(deptIndex).teams[teamIndex]!;
    const getMember = (deptIndex: number, teamIndex: number, memberIndex: number) =>
      getTeam(deptIndex, teamIndex).members[memberIndex]!;
    const getProject = (
      deptIndex: number,
      teamIndex: number,
      memberIndex: number,
      projectIndex: number,
    ) => getMember(deptIndex, teamIndex, memberIndex).projects[projectIndex]!;
    const getTask = (
      deptIndex: number,
      teamIndex: number,
      memberIndex: number,
      projectIndex: number,
      taskIndex: number,
    ) => getProject(deptIndex, teamIndex, memberIndex, projectIndex).tasks[taskIndex]!;

    return { state, getDept, getTeam, getMember, getProject, getTask };
  };

  describe("Deep Object Reading and Reactivity", () => {
    it("should track deeply nested property access", () => {
      const { state, getMember } = createComplexStore();
      let accessCount = 0;

      const deepValue = computed(() => {
        accessCount++;
        return getMember(0, 0, 0).contact.address.coordinates.lat;
      });

      expect(deepValue()).toBe(37.7749);
      expect(accessCount).toBe(1);

      // Update unrelated property - should not trigger recomputation
      update(state, { $set: { "organization.name": "NewTechCorp" } });
      expect(accessCount).toBe(1);

      // Update the tracked deep property
      update(state, {
        $set: {
          "organization.departments.0.teams.0.members.0.contact.address.coordinates.lat": 40.7128,
        },
      });
      expect(deepValue()).toBe(40.7128);
      expect(accessCount).toBe(2);
    });

    it("should track multiple levels of nested arrays and objects", () => {
      const { state, getDept, getTeam, getMember, getTask } = createComplexStore();
      const reactions: string[] = [];

      // Track different nesting levels
      effect(() => {
        state.organization.name;
        reactions.push("org-name");
      });

      effect(() => {
        getDept(0).name;
        reactions.push("dept-name");
      });

      effect(() => {
        getTeam(0, 0).name;
        reactions.push("team-name");
      });

      effect(() => {
        getMember(0, 0, 0).name;
        reactions.push("member-name");
      });

      effect(() => {
        getTask(0, 0, 0, 0, 0).title;
        reactions.push("task-title");
      });

      // Clear initial reactions
      reactions.length = 0;

      // Update at different levels
      update(state, { $set: { "organization.name": "SuperTech" } });
      expect(reactions).toEqual(["org-name"]);
      reactions.length = 0;

      update(state, { $set: { "organization.departments.0.name": "Innovation" } });
      expect(reactions).toEqual(["dept-name"]);
      reactions.length = 0;

      update(state, {
        $set: {
          "organization.departments.0.teams.0.members.0.projects.0.tasks.0.title": "New Migration",
        },
      });
      expect(reactions).toEqual(["task-title"]);
    });

    it("should handle array access within deeply nested structures", () => {
      const { state, getProject } = createComplexStore();

      const taskCounter = computed(() => {
        return getProject(0, 0, 0, 0).tasks.length;
      });

      expect(taskCounter()).toBe(2);

      // Add a new task
      update(state, {
        $push: {
          "organization.departments.0.teams.0.members.0.projects.0.tasks": {
            id: "task-3",
            title: "Performance Optimization",
            completed: false,
          },
        },
      });

      expect(taskCounter()).toBe(3);
    });
  });

  describe("Creating Objects at All Levels", () => {
    it("should create new departments", () => {
      const { state } = createComplexStore();

      update(state, {
        $push: {
          "organization.departments": {
            id: "dept-3",
            name: "Sales",
            budget: 300000,
            teams: [],
            metrics: {
              performance: { leads: 200, conversions: 45, engagement: 65 },
            },
          },
        },
      });

      expect(state.organization.departments).toHaveLength(3);
      expect(state.organization.departments[2]!.name).toBe("Sales");
      expect(state.organization.departments[2]!.budget).toBe(300000);
    });

    it("should create new teams within existing departments", () => {
      const { state, getDept } = createComplexStore();

      update(state, {
        $push: {
          "organization.departments.0.teams": {
            id: "team-3",
            name: "QA Team",
            members: [],
            resources: {
              budget: 80000,
              tools: ["Selenium", "Jest", "Postman"],
            },
          },
        },
      });

      expect(getDept(0).teams).toHaveLength(3);
      expect(getDept(0).teams[2]!.name).toBe("QA Team");
    });

    it("should create new members within existing teams", () => {
      const { state, getTeam } = createComplexStore();

      update(state, {
        $push: {
          "organization.departments.0.teams.0.members": {
            id: "emp-3",
            name: "Carol Davis",
            role: "Full Stack Developer",
            skills: ["React", "Node.js", "MongoDB"],
            projects: [],
            contact: {
              email: "carol@techcorp.com",
              phone: "+1234567893",
              address: {
                street: "789 Code Blvd",
                city: "Seattle",
                state: "WA",
                zip: "98101",
                coordinates: { lat: 47.6062, lng: -122.3321 },
              },
            },
          },
        },
      });

      expect(getTeam(0, 0).members).toHaveLength(3);
      expect(getTeam(0, 0).members[2]!.name).toBe("Carol Davis");
    });
  });

  describe("Updating Fields Deep in the Tree", () => {
    it("should update scalar values at maximum depth", () => {
      const { state, getProject } = createComplexStore();

      // Update CPU threshold in autoscaling config
      update(state, {
        $set: {
          "organization.departments.0.teams.0.members.0.projects.0.metadata.resources.tools.deployment.config.autoscaling.triggers.cpu.threshold": 85,
        },
      });

      const cpuThreshold = getProject(0, 0, 0, 0).metadata.resources.tools.deployment.config
        .autoscaling.triggers.cpu.threshold;
      expect(cpuThreshold).toBe(85);
    });

    it("should increment numeric values deep in structure", () => {
      const { state, getDept, getMember } = createComplexStore();

      // Increment department budget and member coordinates
      update(state, {
        $inc: {
          "organization.departments.0.budget": 50000,
          "organization.departments.0.metrics.performance.velocity": 5,
          "organization.departments.0.teams.0.members.0.contact.address.coordinates.lat": 0.1,
        },
      });

      expect(getDept(0).budget).toBe(550000);
      expect(getDept(0).metrics.performance.velocity).toBe(90);
      expect(getMember(0, 0, 0).contact.address.coordinates.lat).toBeCloseTo(37.8749, 4);
    });

    it("should handle multiple simultaneous deep updates", () => {
      const { state, getDept, getTeam, getMember, getProject, getTask } = createComplexStore();

      update(state, {
        $set: {
          "organization.name": "MegaTech",
          "organization.departments.0.name": "Engineering & Innovation",
          "organization.departments.0.teams.0.name": "Full Stack Team",
          "organization.departments.0.teams.0.members.0.name": "Alice Johnson-Smith",
          "organization.departments.0.teams.0.members.0.projects.0.name": "API Complete Redesign",
          "organization.departments.0.teams.0.members.0.projects.0.tasks.0.title":
            "Advanced Database Migration",
        },
        $inc: {
          "organization.departments.0.budget": 100000,
          "organization.departments.0.teams.0.resources.budget": 25000,
        },
        $push: {
          "organization.departments.0.teams.0.members.0.skills": "GraphQL",
        },
      });

      expect(state.organization.name).toBe("MegaTech");
      expect(getDept(0).name).toBe("Engineering & Innovation");
      expect(getTeam(0, 0).name).toBe("Full Stack Team");
      expect(getMember(0, 0, 0).name).toBe("Alice Johnson-Smith");
      expect(getProject(0, 0, 0, 0).name).toBe("API Complete Redesign");
      expect(getTask(0, 0, 0, 0, 0).title).toBe("Advanced Database Migration");
      expect(getDept(0).budget).toBe(600000);
      expect(getTeam(0, 0).resources.budget).toBe(175000);
      expect(getMember(0, 0, 0).skills).toContain("GraphQL");
    });
  });

  describe("Deleting Objects at All Levels", () => {
    it("should delete departments", () => {
      const { state } = createComplexStore();

      expect(state.organization.departments).toHaveLength(2);

      update(state, {
        $pull: {
          "organization.departments": { id: "dept-2" },
        },
      });

      expect(state.organization.departments).toHaveLength(1);
      expect(state.organization.departments[0]!.id).toBe("dept-1");
    });

    it("should delete teams from departments", () => {
      const { state, getDept } = createComplexStore();

      expect(getDept(0).teams).toHaveLength(2);

      update(state, {
        $pull: {
          "organization.departments.0.teams": { id: "team-2" },
        },
      });

      expect(getDept(0).teams).toHaveLength(1);
      expect(getDept(0).teams[0]!.id).toBe("team-1");
    });

    it("should delete members from teams", () => {
      const { state, getTeam } = createComplexStore();

      expect(getTeam(0, 0).members).toHaveLength(2);

      update(state, {
        $pull: {
          "organization.departments.0.teams.0.members": { id: "emp-2" },
        },
      });

      expect(getTeam(0, 0).members).toHaveLength(1);
      expect(getTeam(0, 0).members[0]!.id).toBe("emp-1");
    });
  });

  describe("Changing Order of Objects at All Levels", () => {
    it("should reorder departments", () => {
      const { state } = createComplexStore();

      // Get original order
      const originalFirst = state.organization.departments[0]!.id;
      const originalSecond = state.organization.departments[1]!.id;
      expect(originalFirst).toBe("dept-1");
      expect(originalSecond).toBe("dept-2");

      // Reverse the order by replacing the entire array
      update(state, {
        $set: {
          "organization.departments": [
            state.organization.departments[1]!,
            state.organization.departments[0]!,
          ],
        },
      });

      expect(state.organization.departments[0]!.id).toBe("dept-2");
      expect(state.organization.departments[1]!.id).toBe("dept-1");
    });

    it("should reorder teams within departments", () => {
      const { state, getDept } = createComplexStore();

      const originalOrder = getDept(0).teams.map((t) => t.id);
      expect(originalOrder).toEqual(["team-1", "team-2"]);

      // Reverse team order
      update(state, {
        $set: {
          "organization.departments.0.teams": [getDept(0).teams[1]!, getDept(0).teams[0]!],
        },
      });

      const newOrder = getDept(0).teams.map((t) => t.id);
      expect(newOrder).toEqual(["team-2", "team-1"]);
    });

    it("should maintain reactivity during reordering", () => {
      const { state, getDept } = createComplexStore();
      let reactionCount = 0;

      const firstTeamName = computed(() => {
        reactionCount++;
        return getDept(0).teams[0]!.name;
      });

      expect(firstTeamName()).toBe("Backend Team");
      expect(reactionCount).toBe(1);

      // Reorder teams
      update(state, {
        $set: {
          "organization.departments.0.teams": [getDept(0).teams[1]!, getDept(0).teams[0]!],
        },
      });

      // Should trigger reaction due to new team at index 0
      expect(firstTeamName()).toBe("Frontend Team");
      expect(reactionCount).toBe(2);
    });
  });

  describe("Adding New Properties and Deep Expansion", () => {
    it("should add new top-level properties", () => {
      const { state } = createComplexStore();

      update(state, {
        $set: {
          "organization.compliance": {
            certifications: ["ISO-27001", "SOC-2"],
            audits: {
              schedule: "quarterly",
              lastAudit: "2024-01-15",
              nextAudit: "2024-04-15",
            },
          },
        },
      });

      expect((state.organization as any).compliance).toBeDefined();
      expect((state.organization as any).compliance.certifications).toEqual(["ISO-27001", "SOC-2"]);
      expect((state.organization as any).compliance.audits.schedule).toBe("quarterly");
    });

    it("should add multiple levels deep to new properties", () => {
      const { state } = createComplexStore();

      // First add a new integration system
      update(state, {
        $set: {
          "organization.integrations": {
            external: {},
          },
        },
      });

      // Then add multiple levels deep
      update(state, {
        $set: {
          "organization.integrations.external.salesforce": {
            enabled: true,
            apiVersion: "v52.0",
            authentication: {
              type: "oauth2",
              clientId: "sf_client_123",
              endpoints: {
                auth: "https://login.salesforce.com/oauth2/authorize",
                token: "https://login.salesforce.com/oauth2/token",
              },
            },
          },
        },
      });

      const sf = (state.organization as any).integrations.external.salesforce;
      expect(sf.enabled).toBe(true);
      expect(sf.authentication.type).toBe("oauth2");
      expect(sf.authentication.endpoints.auth).toBe(
        "https://login.salesforce.com/oauth2/authorize",
      );
    });

    it("should maintain reactivity when adding new deep properties", () => {
      const { state } = createComplexStore();
      let reactionCount = 0;

      // Add new property and start tracking it
      update(state, {
        $set: {
          "organization.newSystem": {
            status: "initializing",
          },
        },
      });

      const statusTracker = computed(() => {
        reactionCount++;
        return (state.organization as any).newSystem?.status;
      });

      expect(statusTracker()).toBe("initializing");
      expect(reactionCount).toBe(1);

      // Update the tracked property
      update(state, {
        $set: {
          "organization.newSystem.status": "running",
        },
      });

      expect(statusTracker()).toBe("running");
      expect(reactionCount).toBe(2);
    });
  });
});
