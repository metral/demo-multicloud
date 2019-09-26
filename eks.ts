import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export class EksCluster extends pulumi.ComponentResource {
    public cluster: eks.Cluster;
    public roles: aws.iam.Role[];
    public provider: k8s.Provider;
    public kubeconfig: pulumi.Output<any>;
    constructor(name: string,
                opts: pulumi.ComponentResourceOptions = {}) {
        super("examples:kubernetes-ts-multicloud:EksCluster", name, {}, opts);

        // Create a VPC.
        const vpc = new awsx.ec2.Vpc(name, {
            cidrBlock: "172.16.0.0/16",
            tags: { "Name": name },
        });

		// AWS Role to use as a k8s 'admin' RBAC user.
        this.roles = [];

        // Create a new IAM role for the developer Alice.
        let pulumiConfig = new pulumi.Config();
        const accountIdRoot = pulumiConfig.require("accountIdRoot");
		let devRole = createIAMRole("alice", accountIdRoot);
        this.roles.push(devRole);

        // Create the EKS cluster.
		this.cluster = new eks.Cluster(name, {
			version: "1.14",
			vpcId: vpc.id,
			publicSubnetIds: vpc.publicSubnetIds,
			instanceType: "t2.medium",
			desiredCapacity: 2,
			minSize: 1,
			maxSize: 2,
			storageClasses: "gp2",
			deployDashboard: false,
            // Map Alice into the cluster RBAC.
			roleMappings      : [
				{
					roleArn   : devRole.arn,
					groups    : ["pulumi:devs"],
					username  : "pulumi:alice",
				},
			],
		});

        this.provider = this.cluster.provider;
        this.kubeconfig = pulumi.output(this.cluster.kubeconfig).apply(JSON.stringify);
    }
}

// Create an IAM Role.
function createIAMRole(name: string, iamPrincipal: string): aws.iam.Role {
    return new aws.iam.Role(`${name}`, {
        assumeRolePolicy: {
            "Version": "2012-10-17",
            "Statement":[
                {
                    "Sid": "",
                    "Effect": "Allow",
                    "Principal": {
                        "AWS": `${iamPrincipal}`,
                    },
                    "Action": "sts:AssumeRole"
                }
            ]
        },
        tags: {
            "clusterAccess": `${name}-k8s-user`,
        },
    });
};
