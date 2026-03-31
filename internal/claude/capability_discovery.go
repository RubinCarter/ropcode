package claude

type DiscoveryStage string

const (
	DiscoveryStageSystem  DiscoveryStage = "system"
	DiscoveryStageUser    DiscoveryStage = "user"
	DiscoveryStageProject DiscoveryStage = "project"
)

type DiscoveryTransport interface {
	Run(stage DiscoveryStage, projectPath string) (CapabilitySnapshot, error)
}

type CapabilityDiscoveryService struct {
	transport DiscoveryTransport
}

func NewCapabilityDiscoveryService(transport DiscoveryTransport) *CapabilityDiscoveryService {
	return &CapabilityDiscoveryService{transport: transport}
}

func (s *CapabilityDiscoveryService) Discover(projectPath string) (CapabilityLayers, error) {
	systemSnapshot, err := s.transport.Run(DiscoveryStageSystem, projectPath)
	if err != nil {
		return CapabilityLayers{}, err
	}

	userSnapshot, err := s.transport.Run(DiscoveryStageUser, projectPath)
	if err != nil {
		return CapabilityLayers{}, err
	}

	projectSnapshot, err := s.transport.Run(DiscoveryStageProject, projectPath)
	if err != nil {
		return CapabilityLayers{}, err
	}

	return BuildCapabilityLayers(systemSnapshot, userSnapshot, projectSnapshot), nil
}
